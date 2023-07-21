import {createGraphQLHttpStreamingFetch} from '@quilted/graphql';

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
      slowestHello: slowHello(wait: 4000)
    }
  }

  fragment PersonFragment on Person {
    slowerHello: slowHello(wait: 2000)
  }
`;

let currentAbort = new AbortController();

async function run() {
  output.textContent = '';
  let lastUpdate = Date.now();
  let updateCount = 0;

  const fetched = fetch(query, {signal: currentAbort.signal});

  for await (const result of fetched) {
    const now = Date.now();
    updateCount += 1;

    output.textContent = JSON.stringify(
      {...result, updates: updateCount, delay: now - lastUpdate},
      null,
      2,
    );

    lastUpdate = now;
  }
}

restart.addEventListener('click', () => {
  currentAbort.abort();
  currentAbort = new AbortController();
  run();
});

await run();
