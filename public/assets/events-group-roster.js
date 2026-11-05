(() => {
  const {api,loadMe}=window.HDS,get=id=>document.getElementById(id),base='/api/events/admin/group-registrations';
  let events=[],nextEvent=null,rows=[],nextGroup=null,listEpoch=0,rosterEpoch=0,listBusy=false,rosterBusy=false,activeEvent='';
  const status=text=>get('group-roster-status').textContent=text;
  function controls(){
    get('group-roster-refresh-events').disabled=listBusy;
    get('group-roster-more-events').hidden=nextEvent===null;get('group-roster-more-events').disabled=listBusy;
    get('group-roster-load').disabled=rosterBusy;
    get('group-roster-more').hidden=nextGroup===null;get('group-roster-more').disabled=rosterBusy;
  }
  function clearRows(){rosterEpoch++;rows=[];nextGroup=null;activeEvent='';rosterBusy=false;get('group-roster-list').replaceChildren();controls();}
  function forget(){listEpoch++;listBusy=false;clearRows();events=[];nextEvent=null;get('group-roster-events').replaceChildren();get('group-roster-event-id').value='';status('');get('event-group-roster').hidden=true;}
  function renderEvents(){const select=get('group-roster-events'),selected=select.value;select.replaceChildren(new Option('Choose a recorded event',''));
    for(const event of events)select.add(new Option(`${event.eventName} · ${new Date(event.startTime).toLocaleString()}`,event.eventId));select.value=selected;controls();}
  function renderRows(){const list=get('group-roster-list');list.replaceChildren();for(const row of rows){
    const item=document.createElement('li'),name=document.createElement('strong'),schedule=document.createElement('p'),payment=document.createElement('p');
    name.textContent=`${row.groupName} (#${row.groupId}) · ${row.groupStatus}`;
    schedule.textContent=`Registered for ${row.event.eventName} · ${new Date(row.event.startTime).toLocaleString()}`;
    payment.textContent=`Paid ${row.cost.toLocaleString()} Valley Coins · Recorded ${new Date(row.registeredAt).toLocaleString()}`;
    item.append(name,schedule,payment);list.append(item);
  }controls();}
  async function loadEvents(more=false){
    if(listBusy)return;const epoch=++listEpoch;listBusy=true;
    if(!more){events=[];nextEvent=null;renderEvents();clearRows();}controls();status('Loading registered events…');
    try{const result=await api(`${base}/events${more?'?afterEventId='+encodeURIComponent(nextEvent):''}`);if(epoch!==listEpoch)return;
      events=more?events.concat(result.events):result.events;nextEvent=result.nextEventId;renderEvents();status(events.length?'Choose an event to view its registered groups.':'No recorded group registrations.');
    }catch(error){if(epoch!==listEpoch)return;if([401,403].includes(error.status))forget();else{if(!more){events=[];nextEvent=null;renderEvents();}status(error.message||'Registered events could not be verified.');}}
    finally{if(epoch===listEpoch){listBusy=false;controls();}}
  }
  async function loadRoster(more=false){
    const eventId=get('group-roster-event-id').value.trim();if(!/^\d{10,24}$/.test(eventId)){status('Enter a valid Discord event ID.');return;}
    if(rosterBusy||(more&&eventId!==activeEvent))return;const epoch=++rosterEpoch;rosterBusy=true;
    if(!more){rows=[];nextGroup=null;activeEvent=eventId;renderRows();}controls();status('Loading group registrations…');
    try{const result=await api(`${base}?eventId=${encodeURIComponent(eventId)}${more?'&afterGroupId='+nextGroup:''}`);if(epoch!==rosterEpoch)return;
      if(result.eventId!==activeEvent)throw new Error('The roster event could not be verified.');rows=more?rows.concat(result.registrations):result.registrations;nextGroup=result.nextGroupId;renderRows();
      status(rows.length?`${rows.length} registered groups shown${nextGroup===null?'.':'; more groups are available.'}`:'No recorded group registrations for this event.');
    }catch(error){if(epoch!==rosterEpoch)return;if([401,403].includes(error.status))forget();else{if(!more){rows=[];nextGroup=null;renderRows();}status(error.message||'Group registrations could not be verified.');}}
    finally{if(epoch===rosterEpoch){rosterBusy=false;controls();}}
  }
  get('group-roster-form').addEventListener('submit',event=>{event.preventDefault();void loadRoster();});
  get('group-roster-event-id').addEventListener('input',()=>{clearRows();status('View registrations to load this event.');});
  get('group-roster-events').addEventListener('change',()=>{get('group-roster-event-id').value=get('group-roster-events').value;clearRows();status('View registrations to load this event.');});
  get('group-roster-refresh-events').addEventListener('click',()=>void loadEvents());
  get('group-roster-more-events').addEventListener('click',()=>void loadEvents(true));get('group-roster-more').addEventListener('click',()=>void loadRoster(true));
  (async()=>{try{if(!(await loadMe())?.user?.is_admin)return;get('event-group-roster').hidden=false;await loadEvents();}catch{forget();}})();
})();
