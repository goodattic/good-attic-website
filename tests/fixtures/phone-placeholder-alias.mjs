export function fixture() {
 const call={google_resource:'customers/4800890529/callViews/alias',market_key:'ut',start_call_date_time:'2026-10-01T12:00:00Z',caller_area_code:'801',call_duration_seconds:20,call_status:'RECEIVED'};
 const quo={quo_call_id:'ACalias',market:'utah',account_id:'2498432',caller_phone:'+18015550101',destination_number:'+13853364442',phone_number_id:'PNalias',call_started_at_utc:'2026-10-01T12:00:00.500Z',direction:'incoming',jobber_client_id:'100',jobber_request_id:'200'};
 const shell={id:'100',name:'+18015550101',market_key:'ut',createdAt:'2026-10-01T12:01:00Z',isArchived:false,phones:[{number:'+18015550101'}],emails:[],history_complete:true,alias_identity_complete:true,alias_address_fingerprints:[],alias_invoice_dates:[]};
 const named={...shell,id:'101',name:'Example Buyer',lastName:'Buyer',createdAt:'2026-10-01T12:01:10Z',emails:[{address:'buyer@example.test'}]};
 const request=(id,c,assessment=null)=>({market_key:'ut',object_type:'request',object_id:id,client_id:c,current_present:true,first_scheduled_at:assessment?'2026-10-01T12:05:00Z':null,object:{id,client:{id:c},createdAt:id==='200'?'2026-10-01T12:01:01Z':'2026-10-01T12:02:00Z',requestStatus:'new',assessment,quotes:{nodes:[]}}});
 const objects=[request('200','100'),request('201','101',{id:'300',startAt:'2026-10-02T12:00:00Z',isComplete:true,completedAt:'2026-10-02T13:00:00Z'}),
 {market_key:'ut',object_type:'quote',object_id:'400',client_id:'101',current_present:true,object:{id:'400',client:{id:'101'},request:{id:'201'},createdAt:'2026-10-02T13:00:00Z',quoteStatus:'converted',amounts:{total:1000},lastTransitioned:{approvedAt:'2026-10-03T12:00:00Z'}}}];
 const intake={operation_id:'qi_alias',account_id:'2498432',market:'utah',phone:quo.caller_phone,source_phone:quo.caller_phone,destination_number:quo.destination_number,phone_number_id:quo.phone_number_id,
  client_id:'100',request_id:'200',quo_call_id:'ACalias',source_type:'call',source_has_name:0,direction:'incoming',source_at:quo.call_started_at_utc,classification:'eligible_new_client',operation_state:'completed',uncertain:0,created_at:'2026-10-01T12:00:59.500Z',updated_at:'2026-10-01T12:01:05Z'};
 return {call,quo,clients:[shell,named],objects,intakeOperations:[intake],historicalRequests:[],dispositions:[],now:'2026-10-13T20:00:00Z'};
}
