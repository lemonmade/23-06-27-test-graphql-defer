import {createProject, quiltWorkspace, quiltApp} from '@quilted/craft';

export default createProject((project) => {
  project.use(
    quiltWorkspace(),
    quiltApp({
      browser: {
        entry: './browser.tsx',
      },
      server: {
        entry: './server.tsx',
      },
    }),
  );
});
