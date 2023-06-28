import {useEffect, useState} from 'react';
// import {createGraphQLHttpFetch} from '@quilted/graphql';
import {createGraphQLHttpFetch} from './graphql-fetch.ts';

export default function App() {
  const [promiseResult, setPromiseResult] = useState<any>();
  const [streamResult, setStreamResult] = useState<any>();

  useEffect(() => {
    run().then((promiseResult) => setPromiseResult(promiseResult));
    (async () => {
      for await (const result of slowRun()) {
        setStreamResult({...result});
      }
    })();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1em',
        padding: '1em',
      }}
    >
      {/* <h2 style={{margin: 0}}>Promise</h2>
      <pre>{JSON.stringify(promiseResult, null, 2)}</pre> */}

      <h2 style={{margin: 0}}>Stream</h2>
      <pre>{JSON.stringify(streamResult, null, 2)}</pre>
    </div>
  );
}

const gql = String;

const query = gql`
  query {
    slowHello(wait: 1000)
    me {
      ...PersonFragment @defer
      self {
        ...PersonFragment @defer
      }
    }
    ... on Query @defer {
      slowerHello: slowHello(wait: 3000)
    }
  }

  fragment PersonFragment on Person {
    slowHello(wait: 2000)
  }
`;

async function* slowRun() {
  const fetch = createGraphQLHttpFetch({
    url: '/graphql',
    headers(headers) {
      headers.set('Accept', 'multipart/mixed');
    },
  });

  yield* fetch(query);

  // console.log(body);
}

async function run() {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: gql`
        query {
          hello
        }
      `,
    }),
  });

  const result = await response.json();

  return result;
}
