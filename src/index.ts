import * as core from '@actions/core';
import { runAction, runPost } from './main';

const isPost = core.getState('isPost') === 'true';
core.saveState('isPost', 'true');

// oxlint-disable-next-line use-unknown-in-catch-callback-variable
(isPost ? runPost() : runAction()).catch((error: any) => {
  core.debug(error.stack || 'No error stack trace');
  core.setFailed(error.message);
});
