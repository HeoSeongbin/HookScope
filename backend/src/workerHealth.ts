import {makeReplayQueue,bounded} from './replayQueue.js';
const queue=makeReplayQueue();
try{const client=await queue.client;const status=await bounded(client.get('hookscope:replay:worker'));process.exitCode=status==='ready'?0:1;}catch{process.exitCode=1;}finally{await queue.close();}
