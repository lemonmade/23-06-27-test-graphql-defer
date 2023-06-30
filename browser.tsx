import {createGraphQLHttpStreamingFetch} from './graphql-fetch.ts';

document.body.innerHTML = `
  <h1>Stream</h1>
  <button id="restart">Restart</button>
  <pre id="result"></pre>
`;

const restart = document.querySelector('#restart')!;
const output = document.querySelector('#result')!;

const fetch = createGraphQLHttpStreamingFetch({
  url: '/graphql',
});

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

let currentAbort = new AbortController();

async function run() {
  output.textContent = '';

  for await (const result of fetch(query, {signal: currentAbort.signal})) {
    output.textContent = JSON.stringify(result, null, 2);
  }
}

restart.addEventListener('click', () => {
  currentAbort.abort();
  currentAbort = new AbortController();
  run();
});

await run();
