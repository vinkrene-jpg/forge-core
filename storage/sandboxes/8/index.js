export function summarize(entries){const out={};for(const e of entries){out[e.actor]=(out[e.actor]||0)+1;}return out;}
