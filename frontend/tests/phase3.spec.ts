import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const env=readFileSync(new URL('../../.env',import.meta.url),'utf8');
const key=env.match(/^ADMIN_KEY=(.+)$/m)![1].trim();
async function login(page:Page){await page.goto('/');await page.getByLabel('개발용 관리 키').fill(key);await page.getByRole('button',{name:'관리 콘솔 열기'}).click();}

test('filters stay active during live updates; inspector preserves structure, copy and raw bytes',async({page,request,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await login(page);
 const name=`Phase 3 검색 검증 ${Date.now()}`;
 await page.getByLabel('엔드포인트 이름').fill(name);await page.getByTitle('엔드포인트 생성').click();
 await expect(page.getByRole('button',{name,exact:true})).toBeVisible();await expect(page.locator('.phase')).toHaveText('실시간 연결됨');
 const url=await page.locator('.url-card code').innerText();
 const post=async(event:string)=>request.post(url+'?tag=one&tag=two',{headers:{'Content-Type':'application/json; charset=utf-8','X-Trace':'phase3-copy'},data:{event,customer:{name:'Heo',api_key:'private-value'},items:[1,2]}});
 expect((await post('phase3.match')).status()).toBe(200);
 expect((await request.put(url,{headers:{'Content-Type':'text/plain'},data:'other request'})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(2);
 await page.getByLabel('Method 필터').selectOption('POST');await page.getByLabel('요청 키워드').fill('phase3.match');await page.getByLabel('Content-Type 필터').fill('application/json');
 await page.getByRole('button',{name:'검색 적용'}).click();await expect(page.locator('.request')).toHaveCount(1);
 expect((await request.put(url,{data:'still excluded'})).status()).toBe(200);
 expect((await post('phase3.match.new')).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(2);await expect(page.locator('.request .method')).toHaveText(['POST','POST']);
 await page.locator('.request').first().click();await expect(page.locator('pre')).toContainText('[REDACTED]');await expect(page.locator('pre')).not.toContainText('private-value');
 await page.getByRole('button',{name:'트리 보기',exact:true}).click();await page.getByRole('button',{name:'customer 펼치기',exact:true}).click();
 await expect(page.locator('.json-tree')).toContainText('Heo');
 await page.getByRole('button',{name:'Headers',exact:true}).click();await page.getByLabel('헤더 검색').fill('x-trace');await expect(page.locator('.kv-row')).toHaveCount(1);
 await page.getByRole('button',{name:'헤더 전체 복사'}).click();expect((await page.evaluate(()=>navigator.clipboard.readText())).toLowerCase()).toContain('x-trace: phase3-copy');
 await page.getByRole('button',{name:'Query',exact:true}).click();await expect(page.locator('.kv-row')).toHaveCount(2);await expect(page.locator('.kv-list')).toContainText('one');await expect(page.locator('.kv-list')).toContainText('two');
 await page.getByRole('button',{name:'Body',exact:true}).click();await page.screenshot({path:fileURLToPath(new URL('../../docs/screenshots/phase3-desktop.png',import.meta.url)),fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:fileURLToPath(new URL('../../docs/screenshots/phase3-mobile.png',import.meta.url)),fullPage:true});
 await page.getByRole('button',{name:'초기화',exact:true}).click();await expect(page.locator('.request')).toHaveCount(4);
 const bytes=Buffer.from([0,255,128,10]);expect((await request.post(url,{headers:{'Content-Type':'application/octet-stream'},data:bytes})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(5);await page.locator('.request').first().click();await expect(page.locator('.binary-note')).toContainText('4 bytes');
 await page.getByRole('button',{name:'Raw',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'원본 다운로드'}).click();
 const download=await downloadPromise;const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks)).toEqual(bytes);
});

test('pagination, ordering and date/status filters query the server',async({page,request})=>{
 await login(page);const name=`Phase 3 페이지 검증 ${Date.now()}`;await page.getByLabel('엔드포인트 이름').fill(name);await page.getByTitle('엔드포인트 생성').click();await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 const url=await page.locator('.url-card code').innerText();
 for(let i=0;i<31;i++)expect((await request.post(url,{data:{index:i}})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(30);await expect(page.locator('.pagination')).toContainText('1 / 2 페이지 · 31건');
 await page.getByRole('button',{name:'다음',exact:true}).click();await expect(page.locator('.request')).toHaveCount(1);await expect(page.locator('.pagination')).toContainText('2 / 2');
 await page.getByLabel('요청 정렬').selectOption('oldest');await page.getByRole('button',{name:'검색 적용'}).click();await expect(page.locator('.pagination')).toContainText('1 / 2');await page.locator('.request').first().click();await expect(page.locator('pre')).toContainText('"index": 0');
 await page.getByLabel('Status 필터').fill('500');await page.getByRole('button',{name:'검색 적용'}).click();await expect(page.locator('.request')).toHaveCount(0);await expect(page.getByText('검색 조건에 맞는 요청이 없습니다')).toBeVisible();
 await page.getByLabel('Status 필터').fill('');await page.getByLabel('수신 종료').fill('2000-01-01T00:00:00');await page.getByRole('button',{name:'검색 적용'}).click();await expect(page.locator('.request')).toHaveCount(0);
 await page.getByRole('button',{name:'초기화',exact:true}).click();await expect(page.locator('.request')).toHaveCount(30);
});

test('form duplicates and malformed JSON stay inspectable without executing received HTML',async({page,request})=>{
 await login(page);const name=`Phase 3 원문 검증 ${Date.now()}`;await page.getByLabel('엔드포인트 이름').fill(name);await page.getByTitle('엔드포인트 생성').click();await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 const url=await page.locator('.url-card code').innerText();
 const form=new URLSearchParams();form.append('tag','one');form.append('tag','two');form.append('html','<img src=x onerror="window.hookscopeXss=1">');
 expect((await request.post(url,{headers:{'Content-Type':'application/x-www-form-urlencoded'},data:form.toString()})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(1);await page.locator('.request').click();await expect(page.locator('.kv-row')).toHaveCount(3);await expect(page.locator('.kv-list')).toContainText('<img');expect(await page.evaluate(()=>Object.hasOwn(window,'hookscopeXss'))).toBe(false);
 const malformed='{ "broken":';expect((await request.post(url,{headers:{'Content-Type':'application/json'},data:Buffer.from(malformed)})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(2);await page.locator('.request').first().click();await expect(page.getByText('JSON 파싱 실패 · Raw 탭에서 원본 확인 가능')).toBeVisible();await page.getByRole('button',{name:'Raw',exact:true}).click();await expect(page.locator('pre')).toHaveText(malformed);
 expect((await request.post(url,{headers:{'Content-Type':'text/plain'},data:'안녕 <script>window.hookscopeXss=1</script>'})).status()).toBe(200);
 await expect(page.locator('.request')).toHaveCount(3);await page.locator('.request').first().click();await expect(page.locator('pre')).toContainText('안녕 <script>');expect(await page.evaluate(()=>Object.hasOwn(window,'hookscopeXss'))).toBe(false);
});
