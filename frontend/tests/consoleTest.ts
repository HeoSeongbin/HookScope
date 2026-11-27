import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const key=readFileSync(new URL('../../.env',import.meta.url),'utf8').match(/^ADMIN_KEY=(.+)$/m)![1].trim();
// One Compose proxy IP is shared by the suite. Respect the real production limiter.
export const test=base.extend<{managementBudget:void}>({managementBudget:[async({request},use)=>{
 const deadline=Date.now()+65000;
 for(;;){
  const response=await request.get('/api/v1/auth/me',{headers:{Authorization:`Bearer ${key}`}});
  const match=response.headers()['ratelimit']?.match(/\br=(\d+)/);
  if(response.ok()&&(!match||Number(match[1])>=120))break;
  if(response.status()!==429&&!response.ok())throw new Error('Management authentication is unavailable');
  if(Date.now()>=deadline)throw new Error('Management rate window did not recover');
  await delay(5000);
 }
 await use();
},{auto:true,timeout:75000}]});
export {expect};
