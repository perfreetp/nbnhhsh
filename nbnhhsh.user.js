// ==UserScript==
// @name         能不能好好说话？
// @namespace    https://lab.magiconch.com/nbnhhsh
// @version      0.16
// @description  拼音首字母缩写划词翻译工具，支持整段解析、我的词库与深色模式
// @author       itorr
// @license      MIT
// @icon         https://lab.magiconch.com/favicon.ico
// @match        *://weibo.com/*
// @match        *://*.weibo.com/*
// @match        *://*.weibo.cn/*
// @match        *://tieba.baidu.com/*
// @match        *://*.bilibili.com/
// @match        *://*.bilibili.com/*
// @match        *://*.douban.com/group/*
// @require      https://lab.magiconch.com/vue.2.6.11.min.js
// @inject-into  content
// @grant        none
// ==/UserScript==

let Nbnhhsh = ((htmlText,cssText)=>{

	const API_URL = 'https://lab.magiconch.com/api/nbnhhsh/';

	/* ---------- 小工具 ---------- */
	const isAbbrText = text => typeof text === 'string' && /[a-z0-9]{2,}/i.test(text);
	const abbrTokens = text => (String(text||'').match(/[a-z0-9]{2,}/ig)||[]);
	const dedupe = arr=>{
		const out=[];
		arr.forEach(v=>{ if(!out.includes(v)) out.push(v); });
		return out;
	};
	const upperName = name => String(name||'').toUpperCase();
	// 规范缩写名（与接口一致：小写）
	const canonName = name => String(name||'').toLowerCase();
	const nowTime = _=>Date.now();

	const copyText = text=>{
		text = String(text==null?'':text);
		if(navigator.clipboard && navigator.clipboard.writeText){
			return navigator.clipboard.writeText(text).catch(_=>fallbackCopy(text));
		}
		return fallbackCopy(text);
	};
	const fallbackCopy = text=>{
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly','');
		ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
		document.body.appendChild(ta);
		ta.select();
		try{ document.execCommand('copy'); }catch(e){}
		document.body.removeChild(ta);
		return Promise.resolve();
	};

	const request = (method,url,data,onOver)=>{
		const x = new XMLHttpRequest();
		x.open(method,url);
		x.setRequestHeader('content-type', 'application/json');
		x.withCredentials = true;
		x.onload = ()=>{
			try{ onOver(x.responseText ? JSON.parse(x.responseText) : null); }
			catch(e){ onOver(null); }
		};
		x.onerror = ()=> onOver(null);
		x.send(JSON.stringify(data));
		return x;
	};

	/* ---------- 存储适配（优先 GM_* 桥接，否则 localStorage） ---------- */
	const gmApi = (function(){
		try{
			if(typeof GM_getValue==='function' && typeof GM_setValue==='function'){
				return { get:GM_getValue, set:GM_setValue, del:typeof GM_deleteValue==='function'?GM_deleteValue:null };
			}
			if(window.GM_getValue && window.GM_setValue){
				return { get:window.GM_getValue, set:window.GM_setValue, del:window.GM_deleteValue||null };
			}
		}catch(e){}
		return null;
	})();
	const storage = {
		get(key, def){
			if(gmApi){
				const v = gmApi.get(key, def);
				return v===undefined ? def : v;
			}
			try{
				const raw = localStorage.getItem(key);
				return raw===null ? def : JSON.parse(raw);
			}catch(e){ return def; }
		},
		set(key,val){
			if(gmApi) return gmApi.set(key,val);
			try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
		},
	};

	/* ---------- 本地词库（历史 / 收藏 / 自定义解释，网页版与脚本共用） ---------- */
	const DATA_KEY = 'nbnhhsh:data:v1';
	const THEME_KEY = 'nbnhhsh:theme';
	const HISTORY_LIMIT = 500;
	const emptyData = _=>({ app:'nbnhhsh', version:1, history:[], favorites:[], custom:{} });

	let data = loadData();

	function loadData(){
		const d = storage.get(DATA_KEY, null);
		if(d && typeof d==='object'){
			return {
				app:'nbnhhsh',
				version:1,
				history:Array.isArray(d.history)?d.history:[],
				favorites:Array.isArray(d.favorites)?d.favorites:[],
				custom:d.custom&&typeof d.custom==='object'?d.custom:{},
			};
		}
		return emptyData();
	}
	function saveData(){
		storage.set(DATA_KEY, data);
		window.dispatchEvent(new CustomEvent('nbnhhsh:store-change'));
	}
	if(!gmApi){
		window.addEventListener('storage',e=>{
			if(e.key === DATA_KEY){
				data = loadData();
				window.dispatchEvent(new CustomEvent('nbnhhsh:store-change'));
			}
		});
	}

	const normalizeCustom = texts=>{
		const arr = Array.isArray(texts) ? texts : [texts];
		return arr.map(t=>String(t==null?'':t).trim()).filter(Boolean);
	};

	const getCustomRaw = name => {
		const arr = data.custom[canonName(name)];
		return Array.isArray(arr) ? arr.slice() : [];
	};

	function snapshotTran(tags){
		const snap = {};
		(tags||[]).forEach(tag=>{
			const list = tagCandidates(tag).slice(0,5);
			if(list.length) snap[canonName(tag.name)] = list;
		});
		return snap;
	}

	function recordHistory(text, tags){
		if(!text) return;
		const time = nowTime();
		const tokens = dedupe(abbrTokens(text).map(canonName));
		if(!tokens.length) return;
		const snap = snapshotTran(tags);
		const map = {};
		data.history.forEach(item=>{ map[canonName(item.name)] = item; });
		tokens.forEach((name,i)=>{
			const old = map[name];
			map[name] = {
				name,
				time: i===0 ? time : (old?old.time:time),
				trans: (snap[name] && snap[name].length) ? snap[name] : (old?old.trans:[]),
			};
		});
		data.history = Object.values(map).sort((a,b)=>b.time-a.time).slice(0,HISTORY_LIMIT);
		saveData();
	}

	const Store = {
		data:null, // 占位，真正的实时数据通过 getData() 获取
		getData(){ return data; },
		isFavorite(name){ return data.favorites.indexOf(canonName(name))!==-1; },
		toggleFavorite(name){
			const key = canonName(name);
			const idx = data.favorites.indexOf(key);
			if(idx===-1) data.favorites.push(key); else data.favorites.splice(idx,1);
			saveData();
			return idx===-1;
		},
		getCustom(name){ return getCustomRaw(name); },
		setCustom(name,texts){
			const key = canonName(name);
			const list = normalizeCustom(texts);
			if(list.length) data.custom[key] = list;
			else delete data.custom[key];
			saveData();
		},
		removeHistory(name){
			const key = canonName(name);
			data.history = data.history.filter(item=>canonName(item.name)!==key);
			saveData();
		},
		clearHistory(){ data.history = []; saveData(); },
		clearAll(){ data = emptyData(); saveData(); },
		exportJSON(){
			return JSON.stringify({
				app:'nbnhhsh',
				version:1,
				history:data.history.map(item=>({ name:item.name, trans:item.trans&&item.trans.length?item.trans:Store.getCustom(item.name).slice(0,5), time:item.time })),
				favorites:data.favorites.slice(),
				custom:JSON.parse(JSON.stringify(data.custom)),
				time:nowTime(),
			},null,'\t');
		},
		importJSON(text){
			let incoming;
			try{ incoming = JSON.parse(text); }catch(e){ return false; }
			if(!incoming || typeof incoming!=='object') return false;
			try{
				if(Array.isArray(incoming.history)){
					// 按名字合并，保留最新一条；导入的条目整体视为最近访问
					const map = {};
					data.history.forEach(item=>{ map[canonName(item.name)] = item; });
					incoming.history.forEach(item=>{
						if(!item || !item.name) return;
						const key = canonName(item.name);
						const incomingTrans = Array.isArray(item.trans) ? item.trans.map(String) : [];
						const custom = Store.getCustom(key);
						const trans = incomingTrans.length
							? incomingTrans
							: (custom.length ? custom.slice(0,5) : []);
						const existing = map[key];
						const mergedTrans = existing
							? existing.trans.concat(trans.filter(t=>existing.trans.indexOf(t)===-1))
							: trans;
						map[key] = {
							name:key,
							trans:mergedTrans.slice(0,5),
							time:Math.max(+item.time||0, existing?existing.time:0) || nowTime(),
						};
					});
					data.history = Object.values(map)
						.filter(item=>item.trans && item.trans.length)
						.sort((a,b)=>b.time-a.time).slice(0,HISTORY_LIMIT);
				}
				if(Array.isArray(incoming.favorites)){
					incoming.favorites.forEach(name=>{
						const key = canonName(name);
						if(data.favorites.indexOf(key)===-1) data.favorites.push(key);
					});
				}
				if(incoming.custom && typeof incoming.custom==='object'){
					Object.keys(incoming.custom).forEach(name=>{
						const list = normalizeCustom(incoming.custom[name]);
						if(list.length) data.custom[canonName(name)] = list;
					});
				}
				saveData();
				return true;
			}catch(e){ return false; }
		},
	};
	Object.defineProperty(Store,'data',{ get(){ return data; } });

	/* ---------- 主题（深色模式，默认跟随系统，可手动切换并记住） ---------- */
	const mediaDark = _=> !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
	const getThemeMode = _=> storage.get(THEME_KEY,'auto');
	const resolveTheme = mode => mode==='dark' || mode==='light' ? mode : (mediaDark()?'dark':'light');
	const applyTheme = _=>{
		const mode = getThemeMode();
		const theme = resolveTheme(mode);
		document.documentElement.setAttribute('data-nbnhhsh-theme', theme);
		document.documentElement.setAttribute('data-theme', theme);
		window.dispatchEvent(new CustomEvent('nbnhhsh:theme-change',{ detail:{ mode, theme } }));
	};
	const Theme = {
		get mode(){ return getThemeMode(); },
		get theme(){ return resolveTheme(getThemeMode()); },
		toggle(){
			const order = ['auto','light','dark'];
			const next = order[(order.indexOf(getThemeMode())+1)%order.length];
			storage.set(THEME_KEY, next);
			applyTheme();
			return next;
		},
		set(mode){
			storage.set(THEME_KEY, ['auto','light','dark'].indexOf(mode)===-1?'auto':mode);
			applyTheme();
		},
	};
	try{
		if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener){
			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
		}
	}catch(e){}
	applyTheme();

	/* ---------- 缩写查询（自定义解释优先于接口结果） ---------- */
	const GuessCache = {};
	const rawGuess = (text,onOver)=>{
		text = dedupe(abbrTokens(text)).join(',');
		if(!text) return onOver([]);
		if(GuessCache[text]!==undefined) return onOver(GuessCache[text]);
		if(rawGuess._request) rawGuess._request.abort();
		const x = request('POST',API_URL+'guess',{text},d=>{
			d = Array.isArray(d) ? d : [];
			GuessCache[text] = d;
			onOver(d);
		});
		rawGuess._request = x;
	};

	function allTranItems(tag){
		if(!tag) return [];
		const items = [];
		transArrange(Array.isArray(tag.trans)?tag.trans:[]).forEach((item,i)=>{
			items.push({ text:item.text, custom: !!tag.custom && i===0, sub:item.sub||'' });
		});
		(Array.isArray(tag.inputting)?tag.inputting:[]).forEach((text,i)=>{
			items.push({ text:String(text), custom:false, guess:true, sub:'', key:'i'+i });
		});
		return items;
	}
	// 候选解释文本：自定义 > trans > inputting
	function tagCandidates(tag){
		if(!tag) return [];
		if(Array.isArray(tag.trans) && tag.trans.length) return tag.trans.map(String);
		if(Array.isArray(tag.inputting) && tag.inputting.length) return tag.inputting.map(String);
		return [];
	}

	// 将自定义解释合并进接口结果（自定义始终排在最前）
	function mergeTags(rawTags, sourceText){
		const byName = {};
		(rawTags||[]).forEach(tag=>{
			const key = upperName(tag.name);
			byName[key] = Object.assign({}, tag, { name:key.toLowerCase(), fav:Store.isFavorite(key) });
		});
		dedupe(abbrTokens(sourceText||'').map(upperName)).forEach(key=>{
			if(!byName[key]) byName[key] = { name:key.toLowerCase(), trans:null, inputting:[], fav:Store.isFavorite(key) };
		});
		return Object.values(byName).map(tag=>{
			const key = upperName(tag.name);
			const customTexts = Store.getCustom(key);
			if(customTexts.length){
				const apiTrans = Array.isArray(tag.trans) ? tag.trans.map(String) : [];
				const merged = customTexts.slice();
				apiTrans.forEach(t=>{ if(merged.indexOf(t)===-1) merged.push(t); });
				tag.trans = merged;
				tag.custom = true;
			}else{
				tag.custom = false;
			}
			tag.customTexts = customTexts;
			tag.fav = Store.isFavorite(key);
			return tag;
		});
	}

	const guess = (text,onOver)=>{
		if(!isAbbrText(text)) return onOver([]);
		if(typeof app!=='undefined' && app && app.loading!==undefined) app.loading = true;
		rawGuess(text,d=>{
			const tags = mergeTags(d, text);
			recordHistory(text, tags);
			if(typeof app!=='undefined' && app && app.loading!==undefined) app.loading = false;
			onOver(tags);
		});
	};

	const submitTran = name=>{
		const text = prompt('输入缩写对应文字 末尾可通过括号包裹（简略注明来源）','');
		if(!text || !text.trim || !text.trim()) return;
		request('POST',API_URL+'translation/'+name,{text},()=>{
			alert('感谢对好好说话项目的支持！审核通过后这条对应将会生效');
		});
	};

	const transArrange = trans=>{
		return (trans||[]).map(tran=>{
			const match = String(tran).match(/^(.+?)([（\(](.+?)[）\)])?$/);
			if(match && match.length === 4) return { text:match[1], sub:match[3] };
			return { text:tran };
		});
	};

	const preferredTran = tag=> tagCandidates(tag)[0] || '';

	// 把一整段文字按缩写切分为片段（key 为大写缩写）
	const tokenizeText = text=>{
		const parts = [];
		const src = String(text||'');
		const re = /[a-z0-9]{2,}/ig;
		let last = 0, m;
		while((m = re.exec(src))){
			if(m.index > last) parts.push({ text:src.slice(last,m.index), abbr:false });
			parts.push({ text:m[0], abbr:true, key:m[0].toUpperCase(), name:m[0].toUpperCase() });
			last = m.index + m[0].length;
		}
		if(last < src.length) parts.push({ text:src.slice(last), abbr:false });
		return parts;
	};

	// 某段缩写的首选解释（自定义优先），未知返回 '？'
	const segExplain = (seg, tagMap)=>{
		const key = upperName(seg.key||seg.name);
		const tag = (tagMap||{})[key];
		if(!tag) return '？';
		return preferredTran(tag) || '？';
	};

	// 生成带解释的译文
	const buildTaggedText = (text, tagMap, mode)=>{
		const left = mode==='plain' ? '(' : '（';
		const right = mode==='plain' ? ')' : '）';
		return tokenizeText(text).map(part=>{
			if(!part.abbr) return part.text;
			const ex = segExplain(part, tagMap);
			if(ex==='？') return part.text;
			return part.text + left + ex + right;
		}).join('');
	};

	/* ---------- 划词浮窗 ---------- */
	let app;

	const getSelectionText = _=>{
		let text = getSelection().toString().trim();
		if(!!text && /[a-z0-9]/i.test(text)) return text;
		return null;
	};

	const POPUP_WIDTH = 360;
	const fixPosition = _=>{
		let rect;
		try{ rect = getSelection().getRangeAt(0).getBoundingClientRect(); }catch(e){ rect = {top:0,left:0,height:0}; }
		const activeEl = document.activeElement;
		if(activeEl && ['TEXTAREA','INPUT'].includes(activeEl.tagName)) rect = activeEl.getBoundingClientRect();
		if(!rect) rect = {top:0,left:0,height:0};

		const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
		const scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft || 0;

		let top  = Math.floor(scrollTop + rect.top + rect.height + 8);
		let left = Math.floor(scrollLeft + rect.left);
		left = Math.max(scrollLeft + 4, Math.min(left, scrollLeft + window.innerWidth - POPUP_WIDTH - 8));
		const maxTop = scrollTop + window.innerHeight - window.innerHeight*0.6 - 12;
		if(top > maxTop) top = Math.max(scrollTop + 8, Math.floor(scrollTop + rect.top - window.innerHeight*0.6 - 8));
		if(rect.top === 0 && rect.left === 0 && rect.height === 0) app.show = false;
		app.top = top;
		app.left = left;
	};

	const timer = _=>{
		if(getSelectionText()) setTimeout(timer,300);
		else app.show = false;
	};

	const nbnhhsh = _=>{
		const text = getSelectionText();
		app.show = !!text && /[a-z0-9]/i.test(text);
		if(!app.show) return;
		app.sourceText = text;
		fixPosition();
		guess(text,data=>{
			if(!data.length) app.show = false;
			else app.tags = data;
		});
		setTimeout(timer,300);
	};
	const _nbnhhsh = _=>{ setTimeout(nbnhhsh,1); };
	document.body.addEventListener('mouseup',_nbnhhsh);
	document.body.addEventListener('keyup',_nbnhhsh);

	const createEl = html=>{
		createEl._el.innerHTML = html;
		const node = createEl._el.children[0];
		document.body.appendChild(node);
		return node;
	};
	createEl._el = document.createElement('div');
	createEl(`<style>${cssText}</style>`);
	const el = createEl(htmlText);

	app = new Vue({
		el,
		data: {
			tags:[],
			show:false,
			loading:false,
			top:0,
			left:0,
			sourceText:'',
			activeIndex:0,
			toastMsg:'',
			themeMode:Theme.mode,
			matchDark:mediaDark(),
		},
		computed:{
			tagMap(){
				const map = {};
				this.tags.forEach(tag=>{ map[upperName(tag.name)] = tag; });
				return map;
			},
			dark(){ return this.themeMode==='auto' ? this.matchDark : this.themeMode==='dark'; },
		},
		watch:{
			tags(){ this.activeIndex = 0; },
			show(v){ if(v){ this.activeIndex = 0; this.themeMode = Theme.mode; } },
		},
		methods:{
			transArrange,
			tagCandidates,
			allTranItems,
			preferredTran,
			isFavorite:name=>Store.isFavorite(name),
			submitTran,
			showToast(msg){
				this.toastMsg = msg;
				clearTimeout(this._toastTimer);
				this._toastTimer = setTimeout(()=>{ this.toastMsg=''; },1300);
			},
			copyTran(text){
				copyText(text).then(()=> this.showToast('已复制：'+text));
			},
			copyTag(tag){
				const text = preferredTran(tag) || canonName(tag.name);
				this.copyTran(text);
			},
			copyAll(){
				const text = buildTaggedText(this.sourceText, this.tagMap, 'bracket');
				copyText(text).then(()=> this.showToast('完整译文已复制'));
			},
			toggleFav(tag){
				Store.toggleFavorite(tag.name);
				tag.fav = Store.isFavorite(tag.name);
				this.showToast(tag.fav ? '已收藏' : '已取消收藏');
			},
			editCustom(tag){
				const current = Store.getCustom(tag.name).join(', ');
				const text = prompt('为「'+upperName(tag.name)+'」添加自定义解释（多个可用逗号分隔，留空删除）', current);
				if(text===null) return;
				Store.setCustom(tag.name, text.split(/[,，]/).map(s=>s.trim()).filter(Boolean));
				this.refresh();
			},
			refresh(){
				if(!this.sourceText) return;
				guess(this.sourceText,data=>{ this.tags = data; });
			},
			cycleTheme(){ this.themeMode = Theme.toggle(); },
			scrollActiveIntoView(){
				this.$nextTick(()=>{
				const nodes = this.$el.querySelectorAll('.nbnhhsh-tag-item');
				const node = nodes[this.activeIndex];
				if(node && typeof node.scrollIntoView==='function') node.scrollIntoView({ block:'nearest' });
				});
			},
			onKeydown(e){
				if(!this.show) return;
				const target = e.target;
				if(target && (target.tagName==='INPUT' || target.tagName==='TEXTAREA' || target.isContentEditable)) return;
				if(e.key==='Escape'){ this.show=false; e.preventDefault(); return; }
				const total = this.tags.length;
				if(!total) return;
				if(e.key==='ArrowDown' || e.key==='ArrowUp'){
					e.preventDefault();
					const dir = e.key==='ArrowDown' ? 1 : -1;
					this.activeIndex = (this.activeIndex + dir + total) % total;
					this.scrollActiveIntoView();
				}else if(e.key==='Enter'){
					e.preventDefault();
					const tag = this.tags[this.activeIndex];
					if(tag) this.copyTag(tag);
				}
			},
		},
		mounted(){
			window.addEventListener('keydown', this.onKeydown, true);
			const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
			if(mq && mq.addEventListener) mq.addEventListener('change', e=>{ this.matchDark = e.matches; });
			window.addEventListener('nbnhhsh:theme-change', e=>{ this.themeMode = e.detail.mode; });
			window.addEventListener('nbnhhsh:store-change', ()=>{ if(this.show) this.$forceUpdate(); });
		},
	});

	return {
		guess,
		submitTran,
		transArrange,
		tagCandidates,
		allTranItems,
		preferredTran,
		tokenizeText,
		segExplain,
		buildTaggedText,
		copyText,
		Store,
		Theme,
		// 向后兼容的细粒度接口
		recordHistory,
		isFavorite:name=>Store.isFavorite(name),
		toggleFavorite:name=>Store.toggleFavorite(name),
		getCustom:name=>Store.getCustom(name)[0]||'',
		setCustom:(name,text)=>Store.setCustom(name,text),
		removeHistory:Store.removeHistory.bind(Store),
		clearHistory:Store.clearHistory.bind(Store),
		clearAll:Store.clearAll.bind(Store),
		exportData:Store.exportJSON.bind(Store),
		importData:(text,mode)=>{
			if(mode==='replace') Store.clearAll();
			return Store.importJSON(text);
		},
		getThemePref:()=>Theme.mode,
		setThemePref:mode=>Theme.set(mode),
		cycleTheme:()=>Theme.toggle(),
		resolvedTheme:()=>Theme.theme,
		applyTheme,
		storage,
	};

})(`
<div class="nbnhhsh-box nbnhhsh-box-pop" :data-theme="dark?'dark':'light'" v-if="show" :style="{top:top+'px',left:left+'px'}" @mousedown.prevent>
	<div class="nbnhhsh-pop-head">
		<span class="nbnhhsh-pop-title">能不能好好说话？</span>
		<span class="nbnhhsh-pop-tools">
			<a class="nbnhhsh-pop-copyall" @click.prevent="copyAll" title="复制带解释的完整译文">复制译文</a>
			<a class="nbnhhsh-pop-theme" @click.prevent="cycleTheme" :title="'主题：'+({auto:'跟随系统',light:'浅色',dark:'深色'}[themeMode])">{{ {auto:'◐',light:'☀',dark:'☾'}[themeMode] }}</a>
			<a class="nbnhhsh-pop-close" @click.prevent="show=false" title="关闭 (Esc)">×</a>
		</span>
	</div>
	<div class="nbnhhsh-loading" v-if="loading">加载中…</div>
	<div class="nbnhhsh-tag-list" v-else-if="tags.length">
		<div class="nbnhhsh-tag-item" :class="{'is-active':$root.activeIndex===tagIndex}" v-for="(tag,tagIndex) in tags" :key="tag.name">
			<h4 @click.prevent="copyTag(tag)" :title="'点击复制 '+($root.tagMap?preferredTran(tag):'')">
				{{tag.name.toUpperCase()}}
				<a class="nbnhhsh-fav" :class="{on:tag.fav}" @click.stop.prevent="toggleFav(tag)" :title="tag.fav?'取消收藏':'收藏'">★</a>
				<a class="nbnhhsh-custom-edit" @click.stop.prevent="editCustom(tag)" title="添加/编辑自定义解释">✎</a>
			</h4>
			<div class="nbnhhsh-tran-list" v-if="tag.trans && tag.trans.length">
				<span
					class="nbnhhsh-tran-item"
					:class="{custom: tag.custom && tranIndex===0}"
					v-for="(tran,tranIndex) in transArrange(tag.trans)"
					:key="'t'+tranIndex"
					@click.stop.prevent="copyTran(tran.text)"
					title="点击复制">
					<em v-if="tag.custom && tranIndex===0" class="nbnhhsh-badge">自定义</em>{{tran.text}}<sub v-if="tran.sub">{{tran.sub}}</sub>
				</span>
			</div>
			<div class="nbnhhsh-notran-box" v-else-if="tag.trans===null && !(tag.inputting && tag.inputting.length)">无对应文字</div>
			<div class="nbnhhsh-inputting-list" v-else-if="tag.inputting && tag.inputting.length">
				<h5>有可能是</h5>
				<span
					class="nbnhhsh-inputting-item"
					v-for="(input,iIndex) in tag.inputting"
					:key="'i'+iIndex"
					@click.stop.prevent="copyTran(input)"
					title="点击复制">{{input}}</span>
			</div>
			<div class="nbnhhsh-notran-box" v-else @click.prevent="submitTran(tag.name)">尚未录入，我来提交对应文字</div>
			<a v-if="tag.trans!==null && tag.trans && tag.trans.length" @click.prevent="submitTran(tag.name)" class="nbnhhsh-add-btn" title="我来提交对应文字"></a>
		</div>
	</div>
	<div class="nbnhhsh-pop-foot" v-if="show && !loading">
		<span>↑↓ 切换缩写 · Enter 复制解释 · Esc 关闭</span>
	</div>
	<div class="nbnhhsh-toast" v-if="toastMsg">{{toastMsg}}</div>
</div>
`, `
.nbnhhsh-box{
	font:400 14px/1.4 sans-serif;
	color:var(--nb-fg,#333);
	background:var(--nb-bg,#fff);
	--nb-bg:#fff;
	--nb-bg-soft:#f5f7fa;
	--nb-fg:#222;
	--nb-fg-light:#777;
	--nb-border:rgba(0,0,0,.12);
	--nb-accent:#0059ff;
	--nb-accent-bg:rgba(0,89,255,.08);
	--nb-active:#cfe3ff;
}
.nbnhhsh-box[data-theme="dark"]{
	--nb-bg:#1e1f24;
	--nb-bg-soft:#2a2c33;
	--nb-fg:#e8eaed;
	--nb-fg-light:#9aa0a8;
	--nb-border:rgba(255,255,255,.14);
	--nb-accent:#79a9ff;
	--nb-accent-bg:rgba(121,169,255,.14);
	--nb-active:#34507e;
	color:var(--nb-fg);
}
.nbnhhsh-box-pop{
	position: absolute;
	z-index:2147483647;
	width: 360px;
	max-width:calc(100vw - 16px);
	max-height:60vh;
	display:flex;
	flex-direction:column;
	background:var(--nb-bg);
	color:var(--nb-fg);
	box-shadow: 0 3px 30px -4px rgba(0,0,0,.35);
	border:1px solid var(--nb-border);
	border-radius:8px;
	overflow:hidden;
}
.nbnhhsh-box-pop::before{
	content: '';
	position: absolute;
	top:-7px;
	left:14px;
	width: 0;
	height: 0;
	border:7px solid transparent;
	border-bottom-color:var(--nb-bg);
	filter: drop-shadow(0 -1px 0 var(--nb-border));
}
.nbnhhsh-pop-head{
	display:flex;
	align-items:center;
	justify-content:space-between;
	padding:6px 12px;
	border-bottom:1px solid var(--nb-border);
	background:var(--nb-bg-soft);
	flex:0 0 auto;
}
.nbnhhsh-pop-title{ font-weight:600; font-size:13px; }
.nbnhhsh-pop-tools a{ cursor:pointer; color:var(--nb-accent); margin-left:10px; font-size:13px; user-select:none; }
.nbnhhsh-tag-list{ overflow:auto; flex:1 1 auto; }
.nbnhhsh-box sub{
	vertical-align: middle;
	background: rgba(128,128,128,.18);
	color: var(--nb-fg-light);
	font-size: 12px;
	line-height:16px;
	display: inline-block;
	padding: 0 3px;
	margin:-2px 0 0 2px;
	border-radius: 2px;
	letter-spacing: -0.6px;
	bottom:0;
}
.nbnhhsh-tag-item{ padding:4px 14px; position: relative; }
.nbnhhsh-tag-item:nth-child(even){ background: var(--nb-accent-bg); }
.nbnhhsh-tag-item.is-active{
	background:var(--nb-active);
	box-shadow: inset 3px 0 0 var(--nb-accent);
}
.nbnhhsh-tag-item.is-active:nth-child(even){ background:var(--nb-active); }
.nbnhhsh-tag-item h4{
	font-weight:bold;
	font-size:20px;
	line-height:28px;
	letter-spacing: 1.5px;
	margin:0;
	display:flex;
	align-items:center;
	gap:6px;
	cursor:pointer;
}
.nbnhhsh-fav,
.nbnhhsh-custom-edit{
	font-size:14px;
	cursor:pointer;
	color:var(--nb-fg-light);
	text-decoration:none;
	letter-spacing:0;
}
.nbnhhsh-fav.on{ color:#f5a623; }
.nbnhhsh-tran-list{ color:var(--nb-fg); padding: 0 0 4px 0; line-height:18px; }
.nbnhhsh-tran-item{ display: inline-block; padding: 2px 15px 2px 0; cursor:pointer; border-radius:4px; }
.nbnhhsh-tran-item.custom{ color:var(--nb-accent); font-weight:600; }
.nbnhhsh-badge{
	font-style:normal;
	font-size:11px;
	font-weight:400;
	background:var(--nb-accent);
	color:#fff;
	border-radius:3px;
	padding:0 4px;
	margin-right:4px;
	vertical-align:1px;
}
.nbnhhsh-inputting-list{ color:var(--nb-fg); padding: 0 0 4px 0; }
.nbnhhsh-inputting-list h5{ font-size:12px; line-height:24px; color:var(--nb-fg-light); margin:0; }
.nbnhhsh-inputting-item{ margin-right:14px; display:inline-block; cursor:pointer; border-radius:4px; }
.nbnhhsh-notran-box{ padding:4px 0; color:var(--nb-fg-light); cursor: pointer; }
.nbnhhsh-add-btn{
	position: absolute;
	top:0;
	right:0;
	width: 30px;
	line-height: 30px;
	text-align: center;
	color: var(--nb-accent);
	font-size: 16px;
	font-weight: bold;
	cursor: pointer;
}
.nbnhhsh-add-btn:after{ content: '+'; }
.nbnhhsh-loading{ text-align: center; color:var(--nb-fg-light); padding:20px 0; }
.nbnhhsh-pop-foot{
	flex:0 0 auto;
	padding:5px 12px;
	font-size:12px;
	color:var(--nb-fg-light);
	border-top:1px solid var(--nb-border);
	background:var(--nbnb-bg-soft,var(--nb-bg-soft));
}
.nbnhhsh-toast{
	position:absolute;
	left:50%;
	bottom:38px;
	transform:translateX(-50%);
	background:rgba(0,0,0,.82);
	color:#fff;
	font-size:12px;
	padding:5px 12px;
	border-radius:14px;
	white-space:nowrap;
	pointer-events:none;
}
.nbnhhsh-box[data-theme="dark"] .nbnhhsh-toast{ background:rgba(255,255,255,.92); color:#111; }
`);
