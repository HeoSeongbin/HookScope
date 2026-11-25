import {z} from 'zod';

const querySchema=z.object({from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()}).strict();
export type AnalyticsRange={from:Date;to:Date};
export function analyticsRange(input:unknown,now=new Date()):AnalyticsRange {
 const value=querySchema.parse(input);
 const to=value.to?new Date(value.to):now;
 const from=value.from?new Date(value.from):new Date(to.getTime()-86400000);
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to||to.getTime()-from.getTime()>31*86400000)throw new z.ZodError([{code:'custom',path:['from'],message:'Range must be positive and at most 31 days'}]);
 return {from,to};
}
export type AnalyticsCapture={id:string;endpointId:string;method:string;receivedAt:string;responseStatus:number;source:string;parseError:boolean};
export type AnalyticsResult={
 endpointId:string|null;asOf:string;range:{from:string;to:string;bucket:'hour';timezone:'UTC'};
 endpointCount:number;allTimeRequests:number;
 totals:{requests:number;recentHourRequests:number;plannedErrorResponses:number;parseErrors:number;bodyBytes:number;capturePreparationAvgMs:number|null;capturePreparationP95Ms:number|null};
 methods:{method:string;count:number}[];statuses:{status:number;count:number}[];sources:{source:string;count:number}[];
 timeline:{hour:string;count:number}[];
 endpointUsage:{id:string;name:string;count:number}[];
 recentRequests:AnalyticsCapture[];recentErrors:AnalyticsCapture[];
 replay:{attempts:number;timedAttempts:number;avgDurationMs:number|null;p95DurationMs:number|null;statuses:{status:string;count:number}[]};
};
export interface AnalyticsRepository {read(range:AnalyticsRange,endpointId?:string):Promise<AnalyticsResult>}
