// REST response DTO; standalone so the frontend image does not depend on server source.
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
