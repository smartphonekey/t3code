export function wellKnownPollScript(origin: string): string {
  const payload = JSON.stringify({ type: "t3-environment-ready" });
  return `(function(){var o=${JSON.stringify(origin)};function check(){fetch(o+"/.well-known/t3/environment",{credentials:"include",headers:{Accept:"application/json"}}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(x){if(x.ok&&x.j&&x.j.environmentId){window.ReactNativeWebView.postMessage(${payload});}else{setTimeout(check,800);}}).catch(function(){setTimeout(check,800);});}check();})();true;`;
}
