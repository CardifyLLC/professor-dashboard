// A small PostgREST test double. SQL constraints and RPCs have separate real
// PostgreSQL tests; this exercises asynchronous orchestration and compare-and-swap.
export function memoryDb(tables={},fault=()=>false){
 let sequence=0;
 const db={tables,from(table){
  tables[table] ||= [];
  const filters=[];let operation='select',value,options={};
  const run=()=>{
   if(fault({table,operation,value}))return{error:{message:'Synthetic storage failure'}};
   const matches=row=>filters.every(check=>check(row));
   if(operation==='upsert'||operation==='insert'){
    for(const input of Array.isArray(value)?value:[value]){
     const key=options.onConflict||'id',existing=tables[table].find(row=>input[key]!=null&&row[key]===input[key]);
     if(existing){if(!options.ignoreDuplicates)Object.assign(existing,input);}
     else tables[table].push({id:'fixture-'+(++sequence),status:'pending',attempts:0,send_attempts:0,...structuredClone(input)});
    }
   }
   const rows=tables[table].filter(matches);
   if(operation==='update')rows.forEach(row=>Object.assign(row,structuredClone(value)));
   return{data:structuredClone(rows)};
  };
  const query={select(){return query;},eq(key,value){filters.push(row=>row[key]===value);return query;},in(key,values){filters.push(row=>values.includes(row[key]));return query;},
   order(){return query;},range(){return query;},limit(){return query;},
   upsert(input,opts={}){operation='upsert';value=input;options=opts;return query;},insert(input){operation='insert';value=input;return query;},
   update(input){operation='update';value=input;return query;},
   async single(){const result=run();return result.error?result:{data:result.data[0]||null};},async maybeSingle(){return query.single();},
   then(resolve,reject){return Promise.resolve().then(run).then(resolve,reject);}
  };return query;
 }};
 return db;
}
