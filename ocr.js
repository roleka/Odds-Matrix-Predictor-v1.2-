// ============================================================
// Odds Matrix Predictor - screenshot reader (OCR)
// ============================================================
// Reads Instant Football screenshots, finds the Home Team O/U and
// Away Team O/U markets and returns the 14 model inputs.
// The market engine below is the one tested in the 16-Market
// Predictor (103 of 103 odds on real screenshots, 0 wrong).
// Only ONE screenshot is needed: the page showing "Home Team O/U"
// and "Away Team O/U". Extra screenshots do no harm.
// ============================================================

// ---------- market recognition engine ----------

function cleanOcrLine(s){
  return String(s||"")
    .replace(/[|¦]/g," ")
    .replace(/[‐‑‒–—]/g,"-")
    .replace(/\s+/g," ")
    .trim();
}

function oddsIn(s){
  return [...String(s).matchAll(
    /(?<![\d.])(\d{1,3}[.,]\d{2})(?!\d|[.,]\d)/g
  )]
    .map(m=>({
      v:Number(m[1].replace(",",".")),
      i:m.index
    }))
    .filter(x=>
      Number.isFinite(x.v)&&x.v>=1.01&&x.v<=1000
    );
}

// Like oddsIn, but also recovers prices where OCR dropped the decimal
// point: "2290" -> 22.90, "153" -> 1.53. Marked rep:true.
function oddsLoose(s){
  const str=String(s);
  const good=oddsIn(str);
  const fixed=[...str.matchAll(/(?<![\d.,:\-])(\d{3,4})(?![\d.,:\-])/g)]
    .map(m=>({v:Number(m[1])/100,i:m.index,rep:true,raw:m[1]}))
    .filter(x=>x.v>=1.01&&x.v<=100);
  // Colon read instead of a decimal point: "1:15" -> 1.15. A single digit
  // before and two after, so scores (1:0) and times (03:24) never match.
  const colon=[...str.matchAll(/(?<![\d.,:])(\d):(\d{2})(?![\d.,:])/g)]
    .map(m=>({v:Number(m[1]+"."+m[2]),i:m.index,rep:true,raw:m[0]}))
    .filter(x=>x.v>=1.01);
  return [...good,...fixed,...colon].sort((a,b)=>a.i-b.i);
}

// Prices and locked cells in screen order, after position `from`.
// The app writes "LOCKED" into lock cells before OCR, so a row like
// "Home 1.16 Home LOCKED Draw or 2.45" still lines up with its columns.
function slots(line,from=-1){
  const locks=[...String(line).matchAll(/locked/gi)].map(m=>({locked:true,i:m.index}));
  return [...oddsLoose(line),...locks].filter(x=>x.i>from).sort((a,b)=>a.i-b.i);
}

function putSlots(out,keys,sl,line){
  if(sl.length!==keys.length)return false;
  keys.forEach((k,j)=>{if(!sl[j].locked)putFrom(out,k,sl[j],line);});
  return true;
}

const PAGE_ORDER=["FT_1X2","FT_1X2_1UP","FT_1X2_2UP","FT_OU","Home_Team_OU",
  "Away_Team_OU","FT_Double_Chance","GG_NG","HANDICAP","Teams_to_Score",
  "Correct_Score","Incorrect_Score_proxy","HT_1X2","HT_OU",
  "HT_Double_Chance","HT_First_Goal"];

// Site grid order for Correct Score (row by row): 0:0 1:0 2:0 3:0 4:0 0:1 ...
const CS_ORDER=[0,1,2,3,4].flatMap(a=>[0,1,2,3,4].map(h=>`${h}-${a}`));

function putFrom(out,key,o,line){
  putMatch(out,key,o.v,line);
  if(o.rep&&out[key]&&!out[key].conflict){
    out[key].repaired=o.raw;
  }
}

function putMatch(out,key,odd,line){
  if(!key||!Number.isFinite(odd)||odd<1.01||odd>1000)return;

  if(out[key]&&Math.abs(out[key].odd-odd)>.001){
    out[key].conflict=true;
    out[key].alternatives=[out[key].odd,odd];
    return;
  }

  out[key]={odd,line};
}

// Unlabelled single value: recorded for review but never auto-filled.
function putUncertain(out,key,odd,line){
  if(out[key])return;
  out[key]={odd,line,uncertain:true};
}

// Markets the model does not use. Seeing one of these headers must stop
// the previous market from swallowing its odds.
const OTHER_MARKET=/last goal|goal bounds|odd\s*\/\s*even|highest scoring|ht\s*\/\s*ft|half\s*time\s*\/\s*full|clean sheet|win to nil|exact goals|multi\s*goals?|corner|card|booking|penalt|draw no bet|winning margin|\s(?:&|\+)\s|\band\b.*(?:o\s*\/\s*u|gg|1x2)/;

function parseMarketOCR(raw){
  const lines=String(raw||"")
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean);

  const out={};
  let active=null;
  const lastLine={};   // last O/U goal line seen per market
  let csPrev=-1;       // index of last correct-score cell assigned
  let atTop=false;     // true until the first real line of a screenshot
  const orphans=[];    // O/U rows found at the top of a screenshot
  const OU_MARKETS=["FT_OU","HT_OU","Home_Team_OU","Away_Team_OU"];
  const OU_MAX={FT_OU:5.5,HT_OU:3.5,Home_Team_OU:3.5,Away_Team_OU:3.5};
  let half=false;
  let blocked=false;   // last heading was a market the model does not use
  let guessed=null;    // market whose heading was unreadable
  const queueGuess=[]; // O/U rows to flag once filled

  const noteGuess=(keys)=>keys.forEach(k=>{
    if(out[k]&&!out[k].conflict&&!out[k].why){
      out[k].repaired=out[k].repaired||"(heading unreadable)";
      out[k].why="market heading unreadable, taken from page order";
    }
  });

  for(const line of lines){
    const lo=line.toLowerCase();

    // Screenshots are consecutive scrolls, so the market at the bottom
    // of one usually continues at the top of the next (e.g. O/U 5.5).
    // Keep the active market; just skip the boundary marker.
    if(/next screenshot/.test(lo)){atTop=true;continue;}

    // Status bar / app header / footer lines repeated on every screenshot.
    if(/instant football|main goals|betslip|next round|\bngn\b|\bvs\b|^\d{1,2}:\d{2}\s+\S/.test(lo))continue;

    // A row like "5.5 7.81 1.08" at the very top of a screenshot belongs
    // to the market at the bottom of the screenshot ABOVE it in scroll
    // order. If screenshots were chosen in a different order, the
    // current market is wrong, so park the row and place it at the end.
    if(atTop){
      const om=line.match(/^([0-5])(?:\s*[.,:]\s*|\d?)5\)?\s+(\d{1,3}[.,]\d{2})\s+(\d{1,3}[.,]\d{2})$/);
      if(om&&!OU_MARKETS.includes(active)){
        orphans.push({
          n:Number(om[1])+0.5,
          o:Number(om[2].replace(",",".")),
          u:Number(om[3].replace(",",".")),
          line
        });
        continue;
      }
      atTop=false;
    }

    const lineOdds=oddsIn(line);

    // Must run BEFORE the 1X2 / O/U / Double Chance checks, otherwise
    // "2nd Half 1X2" or "1X2 & O/U" is read as the full-time market.
    if(/2nd\s*half|second half/.test(lo) ||
       (!lineOdds.length&&OTHER_MARKET.test(lo))){
      active=null;
      half=false;
      blocked=true;
      continue;
    }


    // FIRST HALF MARKETS

    if(/1st\s*half\s*1x2/.test(lo)){
      half=true;
      active="HT_1X2";
      blocked=false;guessed=null;
      continue;
    }

    if(/1st\s*half\s*(o\s*\/\s*u|0\s*\/\s*u|over\s*\/\s*under)/.test(lo)){
      half=true;
      active="HT_OU";
      blocked=false;guessed=null;
      continue;
    }

    if(/1st\s*half\s*double chance/.test(lo)){
      half=true;
      active="HT_Double_Chance";
      blocked=false;guessed=null;
      continue;
    }

    if(/1st\s*half.*first goal/.test(lo)){
      active="HT_First_Goal";
      blocked=false;guessed=null;
      continue;
    }

    // Any other 1st-half market (e.g. 1st Half Correct Score) is not a
    // model feature; stop it falling through to the full-time parsers.
    if(/1st\s*half|first half/.test(lo)&&!lineOdds.length){
      active=null;
      half=true;
      continue;
    }

    // FULL TIME 1X2 SPECIAL MARKETS

    if(/1x2.*1up/.test(lo)){
      half=false;
      active="FT_1X2_1UP";
      blocked=false;guessed=null;
      continue;
    }

    if(/1x2.*2up/.test(lo)){
      half=false;
      active="FT_1X2_2UP";
      blocked=false;guessed=null;
      continue;
    }

    // CORRECT SCORE

    if(/incorrect score/.test(lo)){
      active="Incorrect_Score_proxy";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/correct score/.test(lo)){
      active="Correct_Score";
      csPrev=-1;
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    // TEAM GOALS

    if(/home team\s*(o\s*\/\s*u|0\s*\/\s*u|over|under)/.test(lo)){
      active="Home_Team_OU";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/away team\s*(o\s*\/\s*u|0\s*\/\s*u|over|under)/.test(lo)){
      active="Away_Team_OU";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/teams? to score/.test(lo)){
      active="Teams_to_Score";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/gg\s*\/\s*ng/.test(lo)){
      active="GG_NG";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/handicap/.test(lo)){
      active="HANDICAP";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    if(/double chance/.test(lo)){
      active="FT_Double_Chance";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    // Full-time "First Goal" (no "1st half") is a different market that
    // the model does not use. It used to be filed as 1st Half First Goal.
    if(/first goal/.test(lo)&&!lineOdds.length){
      active=null;blocked=true;
      continue;
    }

    // FULL TIME 1X2
    // Now accepts preceding OCR symbols such as "v 1X2".

    if(/\b1x2\b/.test(lo)){
      active="FT_1X2";
      half=false;
      blocked=false;guessed=null;
      continue;
    }

    // FULL TIME O/U
    // Accepts O/U, 0/U and Over/Under.

    if(/\b(?:o|0)\s*\/\s*u\b/.test(lo) ||
       /\bover\s*\/\s*under\b/.test(lo)){
      active=half?"HT_OU":"FT_OU";
      blocked=false;guessed=null;
      continue;
    }

    // (a heading line above changed the market and `continue`d)

    const odds=lineOdds;

    // Rows that identify their own market even if its heading was misread.
    if(odds.length&&!blocked){
      if(/\byes\b/.test(lo)&&/\bno\b/.test(lo)&&active!=="GG_NG"){
        active="GG_NG";guessed="GG_NG";
      }else if(/only\s*home|only\s*away|both\s*teams/.test(lo)&&active!=="Teams_to_Score"){
        active="Teams_to_Score";guessed="Teams_to_Score";
      }else if(/^(?:0?[.,:]5|05)\s+\d/.test(line)&&!OU_MARKETS.includes(active)){
        // A "0.5 x y" row starts an O/U block: the heading was misread.
        // Use the next O/U market in page order that is still empty.
        const from=PAGE_ORDER.indexOf(active);
        const next=PAGE_ORDER.slice(from+1).find(mk=>
          OU_MARKETS.includes(mk)&&!out[`${mk}__Over_0.5`]&&!out[`${mk}__Under_0.5`]);
        if(next){active=next;guessed=next;}
      }
    }

    if(!odds.length&&!/locked/i.test(lo))continue;
    if(!active)continue;

    // 1X2 MARKETS

    if([
      "FT_1X2",
      "FT_1X2_1UP",
      "FT_1X2_2UP",
      "HT_1X2"
    ].includes(active)){

      const labels=[
        ...lo.matchAll(/\b(home|draw|away)\b/g)
      ].map(m=>m[1]);

      const labPos=[...lo.matchAll(/\b(home|draw|away)\b/g)];

      if(labPos.length>=3){
        // Each label takes the price between it and the next label, so a
        // locked cell ("Draw LOCKED") only loses its own price.
        // Damaged prices ("Draw 230") are recovered and flagged.
        labPos.slice(0,3).forEach((lm,j)=>{
          const end=lm.index+lm[0].length;
          const stop=j<2?labPos[j+1].index:Infinity;
          const o=slots(line,end-1).find(x=>x.i<stop);
          if(o&&!o.locked){
            putFrom(out,`${active}__${lm[1][0].toUpperCase()+lm[1].slice(1)}`,o,line);
          }
        });
      }else if(labels.length===0){
        // OCR often puts "Home Draw Away" on its own line and the
        // three prices on the next; take them in screen order.
        putSlots(out,["Home","Draw","Away"].map(k=>`${active}__${k}`),slots(line),line);
      }

      continue;
    }

    // DOUBLE CHANCE

    if([
      "FT_Double_Chance",
      "HT_Double_Chance"
    ].includes(active)){
      putSlots(out,["1X","12","X2"].map(k=>`${active}__${k}`),slots(line),line);
      if(guessed===active)noteGuess(["1X","12","X2"].map(k=>`${active}__${k}`));
      continue;
    }

    // GG / NG

    if(active==="GG_NG"){
      putSlots(out,["GG_NG__GG_Yes","GG_NG__NG_No"],slots(line),line);
      if(guessed==="GG_NG")noteGuess(["GG_NG__GG_Yes","GG_NG__NG_No"]);
      continue;
    }

    // TEAMS TO SCORE

    if(active==="Teams_to_Score"){
      const rules=[
        [/\bnone\b/i,"None"],
        [/only\s*home/i,"Only_Home"],
        [/only\s*away/i,"Only_Away"],
        [/both\s*teams|both\b/i,"Both"]
      ];

      let found=false;

      for(const [re,k] of rules){
        const hit=re.exec(line);

        if(hit){
          const val=odds.find(x=>x.i>=hit.index);

          if(val){
            putMatch(out,`Teams_to_Score__${k}`,val.v,line);
            found=true;
          }
        }
      }

      if(!found&&odds.length>=4){
        ["None","Only_Home","Only_Away","Both"].forEach((k,j)=>{
          putMatch(out,`Teams_to_Score__${k}`,odds[j].v,line);
        });
      }
      if(guessed==="Teams_to_Score")
        noteGuess(["None","Only_Home","Only_Away","Both"].map(k=>`Teams_to_Score__${k}`));

      continue;
    }

    // FIRST HALF FIRST GOAL

    if(active==="HT_First_Goal"){
      putSlots(out,["Home","None","Away"].map(k=>`HT_First_Goal__${k}`),slots(line),line);
      continue;
    }

    // HANDICAP MARKETS

    if(active==="HANDICAP"){
      const h=line.match(
        /\b(0\s*[:\-]\s*1|0\s*[:\-]\s*2|1\s*[:\-]\s*0|2\s*[:\-]\s*0)\b/
      );

      const ho=h?slots(line,h.index+h[0].length-1):[];
      if(h&&ho.length===3){
        const key={
          "0-1":"Handicap_0_1",
          "0-2":"Handicap_0_2",
          "1-0":"Handicap_1_0",
          "2-0":"Handicap_2_0"
        }[
          h[1].replace(/\s/g,"").replace(":","-")
        ];

        if(key){
          putSlots(out,["Home","Draw","Away"].map(k=>`${key}__${k}`),ho,line);
        }
      }

      continue;
    }

    // OVER / UNDER MARKETS
    // Allows a single visible odds value.
    // A locked opposite selection must not erase
    // the available selection.

    if([
      "FT_OU",
      "HT_OU",
      "Home_Team_OU",
      "Away_Team_OU"
    ].includes(active)){

      if(!odds.length)continue;   // row with every price locked
      const head=line.slice(0,odds[0].i).replace(/locked/ig,"").trim();

      // Goal line: "2.5", "2,5", "2:5", "25", and slips like "225".
      const m=head.match(
        /^(?:(?:over|under)\s*)?([0-5])(?:\s*[.,:]\s*|\d?)5\)?$/i
      );

      let n=m?Number(m[1])+0.5:null;
      let byOrder=false;

      // Unreadable goal line (e.g. "2.9", "Ly") on a normal two-price
      // row: rows always run 0.5, 1.5, 2.5 ... so take the next one.
      if(n===null&&odds.length===2&&lastLine[active]!=null&&
         head.length<=5&&/\d/.test(head)){
        n=lastLine[active]+1;
        byOrder=true;
      }

      if(n!==null&&odds.length){

        if(n>=0.5&&n<=5.5){
          lastLine[active]=n;
          if(guessed===active){
            const ks=[`${active}__Over_${n}`,`${active}__Under_${n}`];
            queueGuess.push(ks);
          }

          if(byOrder){
            putMatch(out,`${active}__Over_${n}`,odds[0].v,line);
            putMatch(out,`${active}__Under_${n}`,odds[1].v,line);
            [`${active}__Over_${n}`,`${active}__Under_${n}`].forEach(k=>{
              if(out[k]&&!out[k].conflict){
                out[k].repaired=head;
                out[k].why="goal line unreadable, taken from row order";
              }
            });
          }else

          if(odds.length>=2){
            // Two visible columns: Over then Under.
            putMatch(out,`${active}__Over_${n}`,odds[0].v,line);
            putMatch(out,`${active}__Under_${n}`,odds[1].v,line);
          }else{
            // One price (other side locked). Only trust it if the
            // line says which side it is; otherwise flag for review
            // instead of assuming it is Over.
            const hasOver=/\bover\b/.test(lo),hasUnder=/\bunder\b/.test(lo);
            const lk=lo.search(/locked/);
            if(lk>=0){
              // "3.5 16.25 LOCKED" -> Over; "3.5 LOCKED 1.04" -> Under.
              putMatch(out,`${active}__${lk>odds[0].i?"Over":"Under"}_${n}`,odds[0].v,line);
            }else if(hasOver&&!hasUnder){
              putMatch(out,`${active}__Over_${n}`,odds[0].v,line);
            }else if(hasUnder&&!hasOver){
              putMatch(out,`${active}__Under_${n}`,odds[0].v,line);
            }else{
              putUncertain(out,`${active}__Over_${n}`,odds[0].v,line);
            }
          }
        }
      }

      continue;
    }

    // CORRECT SCORE

    if([
      "Correct_Score",
      "Incorrect_Score_proxy"
    ].includes(active)){

      const loose=oddsLoose(line);
      const scores=[...line.matchAll(/\b([0-4])\s*[:\-]\s*([0-4])\b/g)]
        .map(x=>({k:`${x[1]}-${x[2]}`,i:x.index,end:x.index+x[0].length}));
      const other=/\bother\b/i.exec(line);
      const otherAt=other?other.index:Infinity;

      let prevPriceAt=-1;

      loose.filter(o=>o.i<otherAt).forEach(o=>{
        // The label for a price is the score written between the
        // previous price and this one. Previously "3:0 2290 4:0 62.27"
        // gave 3-0 the 4-0 price.
        const lab=[...scores].reverse()
          .find(sc=>sc.end<=o.i&&sc.i>prevPriceAt);
        prevPriceAt=o.i;

        if(lab){
          // Incorrect score: the model only uses 0:0, 1:0, 2:0 and 3:0.
          if(active==="Incorrect_Score_proxy"&&!/^[0-3]-0$/.test(lab.k))return;
          putFrom(out,`${active}__${lab.k}`,o,line);
          csPrev=CS_ORDER.indexOf(lab.k);
          return;
        }

        // Garbled label (e.g. "4 Ie 9.92"): Correct Score cells are
        // always in grid order, so infer it from the previous cell, but
        // only fill when the NEXT label on the line confirms the guess.
        if(active!=="Correct_Score"||csPrev<0)return;
        const guess=csPrev+1;
        if(guess>=CS_ORDER.length)return;
        const next=scores.find(sc=>sc.i>o.i);
        const key=`${active}__${CS_ORDER[guess]}`;
        if(next&&CS_ORDER.indexOf(next.k)===guess+1){
          putFrom(out,key,o,line);
          if(out[key]&&!out[key].conflict){
            out[key].repaired=out[key].repaired||line.slice(Math.max(0,o.i-6),o.i).trim();
            out[key].why="score label unreadable, taken from grid order";
          }
        }else{
          putUncertain(out,key,o.v,line);
        }
        csPrev=guess;
      });

      if(active==="Correct_Score"&&other){
        const odd=loose.find(x=>x.i>other.index);
        if(odd)putFrom(out,"Correct_Score__Other",odd,line);
      }

      continue;
    }
  }

  queueGuess.forEach(noteGuess);

  // Place each parked row after the last row of the one O/U market it
  // can continue (e.g. 5.5 only after FT O/U 4.5). Ambiguous: skip.
  orphans.forEach(r=>{
    const fits=OU_MARKETS.filter(mk=>
      r.n<=OU_MAX[mk]&&
      // 4.5 and 5.5 lines exist only in full-time O/U, so they can be
      // placed even when the screenshot above them was not included.
      (lastLine[mk]===r.n-1||(r.n>3.5&&mk==="FT_OU"))&&
      !out[`${mk}__Over_${r.n}`]
    );
    if(fits.length!==1)return;
    const mk=fits[0];
    [["Over",r.o],["Under",r.u]].forEach(([side,v])=>{
      const k=`${mk}__${side}_${r.n}`;
      putMatch(out,k,v,r.line);
      if(out[k]&&!out[k].conflict){
        out[k].repaired=r.line;
        out[k].why="row from top of another screenshot, placed by order";
      }
    });
    lastLine[mk]=r.n;
  });

  return out;
}


// ---------- team names from the "HOME vs AWAY" bar ----------

function detectTeams(raw){
  const votes={};
  String(raw||"").split(/\r?\n/).forEach(l=>{
    const m=l.match(/([A-Za-z][A-Za-z0-9]{1,11})\s+vs\.?\s+([A-Za-z][A-Za-z0-9]{1,11})/i);
    if(!m)return;
    const k=m[1].toUpperCase()+"|"+m[2].toUpperCase();
    votes[k]=(votes[k]||0)+1;
  });
  const best=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0];
  if(!best)return null;
  const [home,away]=best[0].split("|");
  return {home,away,seen:best[1]};
}


// ---------- image preparation ----------

function markLocks(ctx,w,h){
  const img=ctx.getImageData(0,0,w,h),d=img.data;
  const isLock=k=>{
    const r=d[k],g=d[k+1],b=d[k+2];
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),m=(r+g+b)/3;
    // neutral grey: the cell (80,84,95) and its lock icon (155,164,173);
    // odds text is green and the team-name bar is darker, so untouched
    return mx-mn<=25&&m>=70&&m<=185;
  };
  const minRun=Math.round(w*0.15),tol=8;
  let open=[],rects=[];
  for(let y=0;y<h;y++){
    const runs=[];
    for(let x=0;x<w;){
      if(isLock((y*w+x)*4)){
        const x0=x;
        while(x<w&&isLock((y*w+x)*4))x++;
        if(x-x0>=minRun)runs.push([x0,x]);
      }else x++;
    }
    const next=[];
    runs.forEach(([a,b])=>{
      const k=open.findIndex(r=>Math.abs(r.a-a)<=tol&&Math.abs(r.b-b)<=tol);
      if(k>=0){const r=open.splice(k,1)[0];r.y1=y;next.push(r);}
      else next.push({a,b,y0:y,y1:y});
    });
    rects.push(...open);
    open=next;
  }
  rects.push(...open);
  rects=rects.filter(r=>r.y1-r.y0>=h*0.015);
  ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.font=`bold ${Math.round(w*0.032)}px sans-serif`;
  rects.forEach(r=>{
    ctx.fillStyle="#fff";ctx.fillRect(r.a,r.y0,r.b-r.a+1,r.y1-r.y0+1);
    ctx.fillStyle="#000";ctx.fillText("LOCKED",(r.a+r.b)/2,(r.y0+r.y1)/2);
  });
  return rects.length;
}

function toGray(ctx,w,h){
  const img=ctx.getImageData(0,0,w,h),d=img.data;
  for(let k=0;k<d.length;k+=4){
    const v=Math.round(0.299*d[k]+0.587*d[k+1]+0.114*d[k+2]);
    d[k]=d[k+1]=d[k+2]=v;
  }
  ctx.putImageData(img,0,0);
}

function pageCanvas(bmp){
    const scale=bmp.width<1000?2:1;
    const c=document.createElement("canvas");
    c.width=Math.round(bmp.width*scale);
    c.height=Math.round(bmp.height*scale);
    const ctx=c.getContext("2d",{willReadFrequently:true});
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(bmp,0,0,c.width,c.height);
    markLocks(ctx,c.width,c.height);
    toGray(ctx,c.width,c.height);
    return c;
}

async function prepareForOcr(file){
  try{
    const bmp=await createImageBitmap(file);
    const c=pageCanvas(bmp);
    bmp.close?.();
    return c;
  }catch(e){
    return file; // older browsers: use the original image
  }
}

// ---------- dedicated team-name reader ----------
// The team names ("BRE vs IPS") are white letters on a dark bar next to
// coloured club crests. Read on the whole page they sometimes come out
// wrong ("MCRF" for MCF). So the bar is cut out, enlarged, and only
// near-pure-white, neutral pixels are kept: the letters stay, the bar and
// the coloured crests disappear. Tested on 15 screenshots (3 matches,
// including low-res WhatsApp copies): 15 of 15 read correctly.
// The bar's position scales with screen WIDTH, so it is found the same way
// on taller or shorter phones.
function teamBarCanvas(bmp){
  const w=bmp.width;
  const sx=Math.round(w*0.15),sy=Math.round(w*0.17);
  const sw=Math.round(w*0.70),sh=Math.round(w*0.17);
  const k=2160/w;
  const c=document.createElement("canvas");
  c.width=Math.round(sw*k);c.height=Math.round(sh*k);
  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(bmp,sx,sy,sw,sh,0,0,c.width,c.height);
  const img=ctx.getImageData(0,0,c.width,c.height),d=img.data;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    const mn=Math.min(r,g,b),mx=Math.max(r,g,b);
    const v=(mn>=170&&mx-mn<=40)?0:255;   // white letters -> black on white
    d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  return c;
}

// Pick the two team codes from the bar text, e.g. "of MCF RAY QB ~":
// 3-4 letters with at least 2 capitals (crest scraps are shorter or lower-case).
function namesFromBar(text){
  const toks=String(text||"").split(/\s+/)
    .map(t=>t.replace(/[^A-Za-z0-9]/g,""))
    .filter(t=>/^[A-Za-z]{3,4}$/.test(t)&&(t.match(/[A-Z]/g)||[]).length>=2)
    .filter(t=>!/^vs$/i.test(t));
  return toks.length>=2?{home:toks[0].toUpperCase(),away:toks[1].toUpperCase()}:null;
}

// Most common reading across screenshots wins.
function voteTeams(list){
  const votes={};
  list.filter(Boolean).forEach(t=>{const k=t.home+"|"+t.away;votes[k]=(votes[k]||0)+1;});
  const best=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0];
  if(!best)return null;
  const [home,away]=best[0].split("|");
  return {home,away,seen:best[1]};
}


// Engine key -> this model's key. The model has no Under 3.5 inputs.
const OCR_KEY_MAP={
  "Home_Team_OU__Over_0.5":"H_O05","Home_Team_OU__Under_0.5":"H_U05",
  "Home_Team_OU__Over_1.5":"H_O15","Home_Team_OU__Under_1.5":"H_U15",
  "Home_Team_OU__Over_2.5":"H_O25","Home_Team_OU__Under_2.5":"H_U25",
  "Home_Team_OU__Over_3.5":"H_O35",
  "Away_Team_OU__Over_0.5":"A_O05","Away_Team_OU__Under_0.5":"A_U05",
  "Away_Team_OU__Over_1.5":"A_O15","Away_Team_OU__Under_1.5":"A_U15",
  "Away_Team_OU__Over_2.5":"A_O25","Away_Team_OU__Under_2.5":"A_U25",
  "Away_Team_OU__Over_3.5":"A_O35"
};

// Read the chosen screenshots and return
//   {text, inputs:{H_O05:{odd,repaired,why},...}, problems:{key:"conflict"|"unclear"}, teams}
async function readScreenshots(files,onStatus=()=>{}){
  if(!window.Tesseract)
    throw new Error("OCR engine did not load. Connect to the internet and reload the app.");
  let current=0,worker=null;
  const texts=[],barNames=[];
  try{
    onStatus("Starting OCR engine…");
    worker=await Tesseract.createWorker("eng",1,{
      logger:m=>{
        if(m.status==="recognizing text")
          onStatus(`Reading screenshot ${current+1}/${files.length}: ${Math.round((m.progress||0)*100)}%`);
      }
    });
    // Mode 6 = one uniform block: reads the odds grid row by row.
    await worker.setParameters({tessedit_pageseg_mode:"6"});
    for(let i=0;i<files.length;i++){
      current=i;
      onStatus(`Reading screenshot ${i+1} of ${files.length}…`);
      let bmp=null;
      try{bmp=await createImageBitmap(files[i]);}catch(e){bmp=null;}
      const r=await worker.recognize(bmp?pageCanvas(bmp):files[i]);
      texts.push(r.data.text||"");
      if(bmp){
        // Team-name bar: read as a single line (mode 7), then back to mode 6.
        try{
          await worker.setParameters({tessedit_pageseg_mode:"7"});
          const rb=await worker.recognize(teamBarCanvas(bmp));
          barNames.push(namesFromBar(rb.data.text));
        }catch(e){}
        await worker.setParameters({tessedit_pageseg_mode:"6"});
        bmp.close?.();
      }
    }
  }finally{
    if(worker)worker.terminate().catch(()=>{});
  }
  const text=texts.join("\n\n--- NEXT SCREENSHOT ---\n\n");
  const raw=parseMarketOCR(text);
  const inputs={},problems={};
  Object.entries(OCR_KEY_MAP).forEach(([ek,mk])=>{
    const v=raw[ek];
    if(!v)return;
    if(v.conflict)problems[mk]="conflict ("+v.alternatives.map(x=>x.toFixed(2)).join(" vs ")+")";
    else if(v.uncertain)problems[mk]="unclear (side not known)";
    else inputs[mk]={odd:v.odd,repaired:v.repaired||"",why:v.why||(v.repaired?"decimal point restored":"")};
  });
  // Team names: the dedicated bar reader first; the whole-page reading
  // ("X vs Y") only if the bar gave nothing.
  const teams=voteTeams(barNames)||detectTeams(text);
  return {text,inputs,problems,teams};
}
