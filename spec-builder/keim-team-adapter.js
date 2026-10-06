/* KEIM Spec Builder - team edition adapter (GitHub Pages, no accounts)
   Gives the app the same window.claude.use("db" | "user" | "downloads") API it uses on claude.ai.
   - Products, systems and consultants come from team-data.js (built from the live prototype).
   - Prices are encrypted in team-data.js and only unlock with the team code.
   - Each person's projects and details stay in their own browser (localStorage). */
(function () {
  const D = window.KEIM_TEAM_DATA || { collections: {} };
  const LS = "keimteam:";
  const CODE_KEY = LS + "code";
  const mem = {}; // path -> data, for shared read-only collections
  for (const col in D.collections) for (const id in D.collections[col]) mem[col + "/" + id] = D.collections[col][id];

  const store = {
    get(p) { if (p.startsWith("data/") || p.startsWith("speclog/")) { try { const v = localStorage.getItem(LS + p); return v ? JSON.parse(v) : undefined; } catch (_) { return undefined; } } return mem[p]; },
    set(p, v) { if (p.startsWith("data/") || p.startsWith("speclog/")) { try { localStorage.setItem(LS + p, JSON.stringify(v)); } catch (e) { alert("This browser could not save. Free some space or allow site storage."); throw e; } } else mem[p] = v; fire(p); },
    del(p) { if (p.startsWith("data/") || p.startsWith("speclog/")) { try { localStorage.removeItem(LS + p); } catch (_) {} } else delete mem[p]; fire(p); },
    list(col) {
      const out = []; const pre = col + "/";
      if (col.startsWith("data/") || col.startsWith("speclog")) {
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS + pre)) { const rest = k.slice((LS + pre).length); if (!rest.includes("/")) out.push([rest, JSON.parse(localStorage.getItem(k))]); } } } catch (_) {}
      } else for (const k in mem) if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push([k.slice(pre.length), mem[k]]);
      return out;
    }
  };
  const subs = {}; // collection -> Set(callbacks)
  const parent = p => p.replace(/\/[^/]+$/, "");
  const leaf = p => p.replace(/^.*\//, "");
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const snapOf = col => ({ docs: store.list(col).map(([id, d]) => ({ id, data: () => clone(d) })) });
  function fire(p) { const c = parent(p); (subs[c] || []).forEach(cb => setTimeout(() => cb(snapOf(c)), 0)); }

  function collectionRef(col) {
    return {
      doc: id => docRef(col + "/" + id),
      async get() { return snapOf(col); },
      onSnapshot(cb) { (subs[col] = subs[col] || new Set()).add(cb); setTimeout(() => cb(snapOf(col)), 0); return () => subs[col].delete(cb); }
    };
  }
  function docRef(path) {
    return {
      id: leaf(path),
      collection: name => collectionRef(path + "/" + name),
      async get() { const d = store.get(path); return { exists: d !== undefined, id: leaf(path), data: () => clone(d) }; },
      async set(obj) { store.set(path, clone(obj)); },
      async update(obj) { const cur = store.get(path) || {}; const m = Object.assign({}, cur, clone(obj)); for (const k in obj) if (obj[k] && obj[k].__delete__) delete m[k]; store.set(path, m); },
      async delete() { store.del(path); }
    };
  }
  const db = { collection: collectionRef, doc: docRef };

  /* ---------- team code: unlocks the app and decrypts prices ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decryptPricing(code) {
    const e = D.pricingEnc; if (!e) return null;
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code.trim().toUpperCase()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(e.salt), iterations: e.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(e.iv) }, key, b64(e.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function gate() {
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "lc-ovl"; d.style.zIndex = 9999;
      d.innerHTML = `<form class="lc" novalidate><h2>KEIM team access</h2><p>The Spec Builder is for the KEIM Australia team for now. Enter the team code you were sent. You only need to do this once on each device.</p>
        <label class="f">Team code<input class="i" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="KEIM-XXXX-XXXX" required></label>
        <div class="err"></div><div class="acts"><button class="btn primary">Open the Spec Builder</button></div></form>`;
      document.body.appendChild(d);
      const f = d.querySelector("form"); f.code.focus();
      f.onsubmit = async ev => {
        ev.preventDefault(); const code = f.code.value;
        try { const p = await decryptPricing(code); try { localStorage.setItem(CODE_KEY, code.trim().toUpperCase()); } catch (_) {} d.remove(); res(p); }
        catch (_) { f.querySelector(".err").textContent = "That code is not right. Check the message you were sent, or ask Hoodad."; }
      };
    });
  }
  let ready = null;
  function unlock() {
    if (ready) return ready;
    ready = (async () => {
      let saved = null; try { saved = localStorage.getItem(CODE_KEY); } catch (_) {}
      let pricing = null;
      if (saved) { try { pricing = await decryptPricing(saved); } catch (_) { try { localStorage.removeItem(CODE_KEY); } catch (__) {} } }
      if (!pricing) pricing = await gate();
      if (pricing) mem["config/pricing"] = Object.assign({}, pricing, { showMembers: true });
    })();
    return ready;
  }

  /* ---------- user: one person per browser, named from their details ---------- */
  const UID = "team";
  const userApi = {
    async me() { const c = store.get(`data/users/${UID}/contact`) || {}; return { id: UID, name: c.name || "KEIM team", canEdit: false }; },
    async profiles() { return {}; }
  };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      return { status: "saved" };
    }
  };
  window.claude = {
    async use(name) {
      await unlock();
      if (name === "db") return db;
      if (name === "user") return userApi;
      if (name === "downloads") return downloads;
      return null;
    }
  };
  window.keimTeamReset = () => { try { localStorage.removeItem(CODE_KEY); } catch (_) {} location.reload(); };
})();
