const n=/^(#[0-9a-fA-F]{3,8}|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/;function o(r,t="var(--primary)"){return!r||typeof r!="string"?t:n.test(r)?r:t}export{o as s};
