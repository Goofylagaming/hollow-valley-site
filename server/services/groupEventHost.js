const {validateDescriptor}=require('../../automation-platform/src/services/groupEventRegistration');
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
function createGroupEventHost(db,client){
  function admin(user){if(!user?.is_admin||!Number.isSafeInteger(user.id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND is_admin=1').get(user.id))throw fail('Admin access required',403);}
  function limit(value){if(!Number.isSafeInteger(value)||value<1||value>100)throw fail('Choose a page size from 1 to 100',400);return value;}
  function eventId(value,empty=false){if(typeof value!=='string'||!(empty&&value==='')&&!/^\d{10,24}$/.test(value))throw fail('A valid Discord event ID is required',400);return value;}
  async function index(user,{afterEventId='',limit:count=50}={}){
    admin(user);eventId(afterEventId,true);limit(count);
    const result=await client.index({afterEventId,limit:count});admin(user);
    if(!Array.isArray(result?.events)||result.events.length>count)throw fail('Group event list could not be verified');
    let previous=afterEventId;
    const events=result.events.map(value=>{let item;try{item=validateDescriptor(value);}catch{throw fail('Group event list could not be verified');}
      if(item.eventId<=previous)throw fail('Group event list order could not be verified');previous=item.eventId;return item;});
    if(result.nextEventId!==null&&(events.length!==count||result.nextEventId!==events.at(-1)?.eventId))throw fail('Group event list cursor could not be verified');
    return {events,nextEventId:result.nextEventId};
  }
  async function roster(user,{eventId:id,afterGroupId=0,limit:count=50}={}){
    admin(user);eventId(id);limit(count);if(!Number.isSafeInteger(afterGroupId)||afterGroupId<0)throw fail('A valid group cursor is required',400);
    const result=await client.roster({eventId:id,afterGroupId,limit:count});admin(user);
    if(result?.eventId!==id||!Array.isArray(result.registrations)||result.registrations.length>count)throw fail('Group event roster could not be verified');
    let previous=afterGroupId;
    const hasGroups=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='hv_groups' AND type='table'").get());
    const registrations=result.registrations.map(row=>{
      let event;try{event=validateDescriptor(row.event);}catch{throw fail('Group event roster could not be verified');}
      if(event.eventId!==id||row.eventId!==id||!Number.isSafeInteger(row.groupId)||row.groupId<=previous||!Number.isSafeInteger(row.cost)||row.cost<1||typeof row.registeredAt!=='string'||!Number.isFinite(Date.parse(row.registeredAt)))throw fail('Group event roster could not be verified');previous=row.groupId;
      const group=hasGroups&&db.prepare('SELECT name,status FROM hv_groups WHERE id=?').get(row.groupId);
      return {groupId:row.groupId,groupName:group?.name??`Unavailable website group #${row.groupId}`,groupStatus:group?.status==='active'?'active':group?.status==='closed'?'closed':'unavailable',event,cost:row.cost,registeredAt:row.registeredAt};
    });
    if(result.nextGroupId!==null&&(registrations.length!==count||result.nextGroupId!==registrations.at(-1)?.groupId))throw fail('Group event roster cursor could not be verified');
    return {eventId:id,registrations,nextGroupId:result.nextGroupId};
  }
  return {index,roster};
}
module.exports={createGroupEventHost};
