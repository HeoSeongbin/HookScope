import {test,expect} from './consoleTest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const key=readFileSync(new URL('../../.env',import.meta.url),'utf8').match(/^ADMIN_KEY=(.+)$/m)![1].trim();

test('custom response and real Test Sender preserve endpoint settings and request history',async({page,request})=>{
 await page.goto('/');await page.getByLabel('개발용 관리 키').fill(key);await page.getByRole('button',{name:'관리 콘솔 열기'}).click();
 const name=`Phase 4 테스트 ${Date.now()}`;await page.getByLabel('엔드포인트 이름').fill(name);await page.getByTitle('엔드포인트 생성').click();await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByLabel('응답 모드').selectOption('CUSTOM');await page.getByLabel('응답 Status',{exact:true}).fill('422');await page.getByLabel('응답 Content-Type').selectOption('text/plain');await page.getByLabel('응답 Body',{exact:true}).fill('phase4 rejected');await page.getByLabel('응답 지연').fill('150');await page.getByLabel('응답 Headers').fill('[["X-Test-Result","rejected"]]');
 await page.getByRole('button',{name:'응답 설정 저장'}).click();await expect(page.getByText('응답 설정을 저장했습니다. 다음 수신 요청부터 적용됩니다.')).toBeVisible();
 await page.getByRole('button',{name:'테스트 전송',exact:true}).click();await expect(page.getByLabel('테스트 대상 URL')).toHaveAttribute('readonly','');
 await page.getByLabel('테스트 Body',{exact:true}).fill('{ "event": "phase4.test", "message": "한국어" }');await page.getByLabel('테스트 Headers').fill('[["X-Test-Sender","browser"]]');await page.getByLabel('테스트 Query').fill('[["tag","one"],["tag","two"]]');
 await page.getByRole('button',{name:'테스트 요청 보내기'}).click();await expect(page.locator('.test-result')).toContainText('HTTP 422');await expect(page.locator('.test-result')).toContainText('저장됨');await expect(page.locator('.request .source-test')).toHaveText('TEST');
 await page.getByRole('button',{name:'수신 요청 상세 열기'}).click();await expect(page.locator('.inspector pre')).toContainText('phase4.test');
 await page.getByRole('button',{name:'Query',exact:true}).click();await expect(page.locator('.inspector .kv-row')).toHaveCount(2);
 await page.getByRole('button',{name:'Response',exact:true}).click();await expect(page.locator('.inspector pre')).toContainText('phase4 rejected');await expect(page.locator('.inspector pre')).toContainText('150');
 await page.screenshot({path:fileURLToPath(new URL('../../docs/screenshots/phase4-desktop.png',import.meta.url)),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:fileURLToPath(new URL('../../docs/screenshots/phase4-mobile.png',import.meta.url)),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'응답 설정',exact:true}).click();await page.getByLabel('응답 Status',{exact:true}).fill('204');await page.getByLabel('응답 Body',{exact:true}).fill('');await page.getByLabel('응답 지연').fill('0');await page.getByRole('button',{name:'응답 설정 저장'}).click();await expect(page.getByText('응답 설정을 저장했습니다. 다음 수신 요청부터 적용됩니다.')).toBeVisible();
 await page.getByRole('button',{name:'테스트 전송',exact:true}).click();await page.getByRole('button',{name:'테스트 요청 보내기'}).click();await expect(page.locator('.test-result')).toContainText('HTTP 204');await expect(page.locator('.request')).toHaveCount(2);
 await page.getByRole('button',{name:'응답 설정',exact:true}).click();await page.getByLabel('응답 모드').selectOption('DEFAULT');await page.getByRole('button',{name:'응답 설정 저장'}).click();await expect(page.getByText('응답 설정을 저장했습니다. 다음 수신 요청부터 적용됩니다.')).toBeVisible();
 const url=await page.locator('.url-card code').innerText();const external=await request.post(url,{data:{event:'external'}});expect(external.status()).toBe(200);await expect(page.locator('.request')).toHaveCount(3);await expect(page.locator('.request').first().locator('.source-test')).toHaveCount(0);
 await page.getByLabel('응답 모드').selectOption('CUSTOM');await page.getByLabel('응답 Status',{exact:true}).fill('409');await page.getByLabel('응답 Body',{exact:true}).fill('persisted-custom');await page.getByRole('button',{name:'응답 설정 저장'}).click();await expect(page.getByText('응답 설정을 저장했습니다. 다음 수신 요청부터 적용됩니다.')).toBeVisible();
 // A different endpoint starts with its own default response, and switching back reloads persisted settings.
 const second=`Phase 4 독립 ${Date.now()}`;await page.getByLabel('엔드포인트 이름').fill(second);await page.getByTitle('엔드포인트 생성').click();await expect(page.getByRole('button',{name:second,exact:true})).toBeVisible();await expect(page.getByLabel('응답 모드')).toHaveValue('DEFAULT');
 await page.getByRole('button',{name,exact:true}).click();await expect(page.getByLabel('응답 모드')).toHaveValue('CUSTOM');await expect(page.getByLabel('응답 Status',{exact:true})).toHaveValue('409');await expect(page.getByLabel('응답 Body',{exact:true})).toHaveValue('persisted-custom');
});
