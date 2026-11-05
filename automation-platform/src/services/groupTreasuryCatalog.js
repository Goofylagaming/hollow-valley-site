const {createHash}=require('node:crypto');
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const FRAMES=['fern','sandstone','night'];
function positive(value){if(!Number.isSafeInteger(value)||value<1)throw error('INVALID_SPEND','Positive whole values are required');return value;}
  function exact(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(name=>!keys.includes(name)))throw error('INVALID_CATALOG','Unsupported Treasury item fields');}
  function item(input){
    exact(input,['id','revision','title','description','cost','purpose','target']);
    if(typeof input.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>100||typeof input.description!=='string'||input.description.length>500||/[\x00-\x1f\x7f]/.test(input.title+input.description))throw error('INVALID_CATALOG','Valid item identity and text are required');
    positive(input.revision);positive(input.cost);
    let target;
    if(input.purpose==='group_cosmetic'){
      exact(input.target,['kind','value']);if(input.target.kind!=='profile_frame'||!FRAMES.includes(input.target.value))throw error('INVALID_CATALOG','Choose an available cosmetic profile frame');
      target={kind:'profile_frame',value:input.target.value};
    }else if(input.purpose==='territory_entry'){
      exact(input.target,['eventId']);positive(input.target.eventId);target={eventId:input.target.eventId};
    }else if(input.purpose==='event_registration'){
      exact(input.target,['eventId']);if(typeof input.target.eventId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.target.eventId))throw error('INVALID_CATALOG','A reviewed event identity is required');target={eventId:input.target.eventId};
    }else throw error('INVALID_CATALOG','Treasury purchases support cosmetics and reviewed event entry only');
    return {id:input.id,revision:input.revision,title:input.title.trim(),description:input.description,cost:input.cost,purpose:input.purpose,target};
  }

const digest=input=>createHash('sha256').update(JSON.stringify(item(input))).digest('hex');
module.exports={validateItem:item,digest};
