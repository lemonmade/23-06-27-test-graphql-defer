import type {GraphQLError} from 'graphql';
import type {
  GraphQLAnyOperation,
  GraphQLVariableOptions,
} from '@quilted/graphql';

export interface GraphQLHttpFetchOptions
  extends Pick<RequestInit, 'credentials'> {
  url: string | URL;
  headers?: Record<string, string> | ((headers: Headers) => Headers | void);
  customizeRequest?(request: Request): Request | Promise<Request>;
}

export function createGraphQLHttpFetch({
  url,
  credentials,
  headers: explicitHeaders,
  customizeRequest,
}: GraphQLHttpFetchOptions) {
  return async function* fetchGraphQL<Data, Variables>(
    operation: GraphQLAnyOperation<Data, Variables>,
    options?: GraphQLVariableOptions<Variables> & {signal?: AbortSignal},
  ) {
    let id: string;
    let source: string;
    let operationName: string | undefined;
    const variables = options?.variables ?? {};

    if (typeof operation === 'string') {
      id = source = operation;
    } else if ('definitions' in operation) {
      id = source = operation.loc?.source.body ?? '';
      if (!source) {
        throw new Error(
          `Can’t determine source for document node: ${operation}`,
        );
      }
      operationName = operation.definitions[0]?.name?.value;
    } else {
      id = operation.id;
      source = operation.source;
      operationName = operation.name;
    }

    const resolvedUrl = url;

    let headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });

    if (typeof explicitHeaders === 'function') {
      headers = explicitHeaders(headers) ?? headers;
    } else if (explicitHeaders) {
      for (const header of Object.keys(explicitHeaders)) {
        headers.set(header, explicitHeaders[header]!);
      }
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers,
      signal: options?.signal,
      body: JSON.stringify({
        query: source,
        variables,
        operationName,
      }),
    };

    if (credentials != null) requestInit.credentials = credentials;

    let request = new Request(resolvedUrl, requestInit);
    if (customizeRequest) request = await customizeRequest(request);

    const response = await fetch(request);

    if (!response.ok) {
      return {
        errors: [
          {
            response,
            message: `GraphQL fetch failed with status: ${
              response.status
            }, response: ${await response.text()}`,
          },
        ],
      };
    }

    for await (const payload of parseMultipartMixed(response)) {
      yield payload;
    }
  };
}

// Most of the content below was adapted from:
// https://github.com/urql-graphql/urql/blob/c074a504a05b690fff34212330a3eaa01ba4935c/packages/core/src/internal/fetchSource.ts

const BOUNDARY_HEADER_REGEX = /boundary="?([^=";]+)"?/i;
const NEWLINE_SEPARATOR = '\r\n';
const HEADER_SEPARATOR = NEWLINE_SEPARATOR + NEWLINE_SEPARATOR;

async function* parseMultipartMixed(
  response: Response,
): AsyncIterableIterator<any> {
  const boundaryHeader = (response.headers.get('Content-Type') ?? '').match(
    BOUNDARY_HEADER_REGEX,
  );

  const boundary = '--' + (boundaryHeader ? boundaryHeader[1] : '-');

  let isPreamble = true;
  let result: ExecutionResult | undefined;

  for await (let chunk of splitChunksOnBoundary(
    streamResponseBody(response),
    NEWLINE_SEPARATOR + boundary,
  )) {
    if (isPreamble) {
      isPreamble = false;
      const preambleIndex = chunk.indexOf(boundary);

      if (preambleIndex > -1) {
        chunk = chunk.slice(preambleIndex + boundary.length);
      } else {
        continue;
      }
    }

    try {
      const newResult = JSON.parse(
        chunk.slice(chunk.indexOf(HEADER_SEPARATOR) + HEADER_SEPARATOR.length),
      );

      result = mergeResultPatch(result ?? {}, newResult);
      yield result;
    } catch (error) {
      if (!result) throw error;
    }

    if (result?.hasNext === false) break;
  }

  if (result && result.hasNext !== false) {
    yield {hasNext: false};
  }
}

async function* streamResponseBody(
  response: Response,
): AsyncIterableIterator<string> {
  const decoder = new TextDecoder();

  if (response.body![Symbol.asyncIterator]) {
    for await (const chunk of response.body! as any) {
      yield decoder.decode(chunk);
    }
  } else {
    let result: ReadableStreamReadResult<Uint8Array>;
    const reader = response.body!.getReader();

    try {
      while (!(result = await reader.read()).done) {
        console.log(decoder.decode(result.value));
        yield decoder.decode(result.value);
      }
    } finally {
      reader.cancel();
    }
  }
}

async function* splitChunksOnBoundary(
  chunks: AsyncIterableIterator<string>,
  boundary: string,
) {
  let buffer = '';
  let boundaryIndex: number;

  for await (const chunk of chunks) {
    buffer += chunk;
    while ((boundaryIndex = buffer.indexOf(boundary)) > -1) {
      yield buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundary.length);
    }
  }
}

export interface IncrementalPayload {
  label?: string | null;
  path: readonly (string | number)[];
  // For @defer
  data?: Record<string, unknown> | null;
  // For @stream
  items?: readonly unknown[] | null;
  errors?: Partial<GraphQLError>[] | readonly Partial<GraphQLError>[];
  extensions?: any;
}

export interface ExecutionResult {
  incremental?: IncrementalPayload[];
  data?: null | Record<string, any>;
  errors?: Partial<GraphQLError>[];
  extensions?: any;
  hasNext?: boolean;
}

function deepMerge(target: any, source: any): any {
  if (
    typeof target === 'object' &&
    target != null &&
    (!target.constructor ||
      target.constructor === Object ||
      Array.isArray(target))
  ) {
    target = Array.isArray(target) ? [...target] : {...target};

    for (const key of Object.keys(source)) {
      target[key] = deepMerge(target[key], source[key]);
    }

    return target;
  }

  return source;
}

function mergeResultPatch(
  result: ExecutionResult,
  nextResult: ExecutionResult,
): ExecutionResult {
  let incremental = nextResult.incremental;

  // NOTE: We handle the old version of the incremental delivery payloads as well
  if ('path' in nextResult) {
    incremental = [nextResult as IncrementalPayload];
  }

  if (incremental) {
    for (const patch of incremental) {
      if (Array.isArray(patch.errors)) {
        result.errors ??= [];
        result.errors.push(...patch.errors);
      }

      if (patch.extensions) {
        result.extensions ??= {};
        Object.assign(result.extensions, patch.extensions);
      }

      let prop: string | number = 'data';
      let part: any = result;
      for (let i = 0, l = patch.path.length; i < l; prop = patch.path[i++]!) {
        part = part[prop];
      }

      if (patch.items) {
        const startIndex = Math.max(
          0,
          typeof prop === 'number' ? prop : Number.parseInt(prop, 10),
        );

        for (let i = 0; i < patch.items.length; i++)
          part[startIndex + i] = deepMerge(
            part[startIndex + i],
            patch.items[i],
          );
      } else if (patch.data !== undefined) {
        part[prop] = deepMerge(part[prop], patch.data);
      }
    }
  } else {
    result.data = nextResult.data || result.data;
    result.errors = nextResult.errors || result.errors;
  }

  if (nextResult.extensions) {
    result.extensions ??= {};
    Object.assign(result.extensions, nextResult.extensions);
  }

  result.hasNext = nextResult.hasNext ?? result.hasNext;

  console.log(result);

  return result;
}
