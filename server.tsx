import {createRequestRouter, createServerRender} from '@quilted/quilt/server';
import {createBrowserAssets} from '@quilted/quilt/magic/assets';

import {createYoga, createSchema} from 'graphql-yoga';
import {useDeferStream} from '@graphql-yoga/plugin-defer-stream';

const router = createRequestRouter();

const yoga = createYoga({
  schema: createSchema({
    typeDefs: `
      type Query {
        hello: String!
        slowHello(wait: Int!): String!
        me: Person!
      }

      type Person {
        self: Person!
        slowHello(wait: Int!): String!
      }
    `,
    resolvers: {
      Query: {
        hello: () => 'Hello world!',
        slowHello: async (_, {wait}: {wait: number}) => {
          await new Promise((resolve) => setTimeout(resolve, wait));
          return 'Hello world!';
        },
        me: () => ({}),
      },
      Person: {
        self: () => ({}),
        slowHello: async (_, {wait}: {wait: number}) => {
          await new Promise((resolve) => setTimeout(resolve, wait));
          return 'Hello world!';
        },
      },
    },
  }),
  // eslint-disable-next-line react-hooks/rules-of-hooks
  plugins: [useDeferStream()],
});

router.post('/graphql', (request) => yoga.fetch(request));

// For all GET requests, render our React application.
router.get(
  createServerRender(async () => <></>, {
    assets: createBrowserAssets(),
  }),
);

export default router;
