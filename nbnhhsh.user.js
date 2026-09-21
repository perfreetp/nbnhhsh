// ==UserScript==
// @name         能不能好好说话？
// @namespace    https://lab.magiconch.com/nbnhhsh
// @version      0.16
// @description  首字母缩写划词翻译工具（批量解析、我的词库、深色模式）
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
	const STORE_KEY = 'nbnhhsh.v1';

	const request = (method,url,data,onOver)=>{
		let x = new XMLHttpRequest();
		x.open(method,url);
		x.setRequestHeader('content-type', 'application/json');
		x.withCredentials = true;
		x.onload = ()=> onOver(x.responseText ? JSON.parse(x.responseText) : null);
		x.send(JSON.stringify(data));
		return x;
	};

	/* ---------- 我的词库：历史 / 收藏 / 自定义解释 / 主题（网页版与脚本共用同一份 localStorage 数据） ---------- */

	const DEFAULT_STORE = {
		history: [],   // [{name,time}]
		favs: {},      // {name:true}
		custom: {},    // {name:'自定义解释'}
		choice: {},    // {name:'已选候选'}（整段解析复制时使用）
		theme: 'auto', // auto | light | dark
		version: 1
	};
	const HISTORY_LIMIT = 500;

	let store;
	try{
		store = Object.assign({}, DEFAULT_STORE, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
	}catch(e){
		store = Object.assign({}, DEFAULT_STORE);
	}

	const saveStore = _=>{
		try{ localStorage.setItem(STORE_KEY, JSON.stringify(store)); }catch(e){}
	};

	const storeListeners = [];
	const emitStore = _=>{
		saveStore();
		storeListeners.forEach(fn=>{ try{ fn(store); }catch(e){} });
	};
	const onStoreChange = fn=>{
		storeListeners.push(fn);
		return _=>{
			let i = storeListeners.indexOf(fn);
			if(i > -1) storeListeners.splice(i,1);
		};
	};

	const getCustom = name => (store.custom[String(name).toLowerCase()] || '').trim();

	const decorateTag = tag=>{
		let custom = getCustom(tag.name);
		if(custom){
			tag = Object.assign({}, tag, { _origTrans: tag.trans || null, trans:[custom], custom:true });
		}
		tag.fav = !!store.favs[String(tag.name).toLowerCase()];
		return tag;
	};

	const recordHistory = names=>{
		let map = {};
		store.history.forEach(item=>{ map[item.name] = item; });
		names.forEach(name=>{
			map[name] = { name, time: Date.now() };
		});
		store.history = Object.keys(map)
			.map(name=>map[name])
			.sort((a,b)=> b.time - a.time)
			.slice(0, HISTORY_LIMIT);
	};

	const GuessCache = {};

	const guess = (text,onOver)=>{
		let tokens = (text.match(/[a-z0-9]{2,}/ig) || []).map(s=>s.toLowerCase());
		let key = Array.from(new Set(tokens)).join(',');

		const finish = data=>{
			let decorated = data.map(decorateTag);
			recordHistory(decorated.map(tag=>tag.name));
			emitStore();
			onOver(decorated);
		};

		if(GuessCache[key]){
			return finish(GuessCache[key]);
		}

		if(guess._request){
			guess._request.abort();
		}

		if(typeof app !== 'undefined') app.loading = true;
		guess._request = request('POST',API_URL+'guess',{text:key},data=>{
			GuessCache[key] = data;
			if(typeof app !== 'undefined') app.loading = false;
			finish(data);
		});
	};

	const submitTran = name=>{
		let text = prompt('输入缩写对应文字 末尾可通过括号包裹（简略注明来源）','');

		if(!text || !text.trim || !text.trim()){
			return;
		}

		request('POST',API_URL+'translation/'+name,{text},()=>{
			alert('感谢对好好说话项目的支持！审核通过后这条对应将会生效');
		});
	};

	const transArrange = trans=>{
		return trans.map(tran=>{
			const match = tran.match(/^(.+?)([（\(](.+?)[）\)])?$/);

			if(match.length === 4){
				return {
					text:match[1],
					sub:match[3]
				}
			}else{
				return {
					text:tran
				}
			}
		})
	};

	/* ---------- 词库操作 ---------- */

	const lib = {
		data:_=> store,
		subscribe: onStoreChange,
		setCustom(name,text){
			name = String(name).toLowerCase().trim();
			text = (text || '').trim();
			if(!name) return;
			if(text) store.custom[name] = text;
			else delete store.custom[name];
			emitStore();
		},
		toggleFav(name){
			name = String(name).toLowerCase();
			if(store.favs[name]) delete store.favs[name];
			else store.favs[name] = true;
			emitStore();
			return !!store.favs[name];
		},
		setChoice(name,text){
			name = String(name).toLowerCase();
			store.choice[name] = text;
			emitStore();
		},
		remove(name){
			name = String(name).toLowerCase();
			delete store.favs[name];
			delete store.custom[name];
			delete store.choice[name];
			store.history = store.history.filter(item=>item.name !== name);
			emitStore();
		},
		clearHistory(){
			store.history = [];
			emitStore();
		},
		clearAll(){
			store = Object.assign({}, DEFAULT_STORE, { theme: store.theme });
			emitStore();
		},
		importData(obj){
			obj = obj || {};
			if(Array.isArray(obj.history)){
				let map = {};
				store.history.concat(obj.history).forEach(item=>{
					if(item && item.name) map[item.name] = item;
				});
				store.history = Object.keys(map).map(n=>map[n])
					.sort((a,b)=>(b.time||0)-(a.time||0))
					.slice(0, HISTORY_LIMIT);
			}
			if(obj.favs) Object.assign(store.favs, obj.favs);
			if(obj.custom) Object.assign(store.custom, obj.custom);
			if(obj.choice) Object.assign(store.choice, obj.choice);
			emitStore();
		},
		exportData:_=>JSON.stringify({
			history: store.history,
			favs: store.favs,
			custom: store.custom,
			choice: store.choice,
			exportedAt: new Date().toISOString()
		}, null, 2)
	};

	/* ---------- 深色模式：默认跟随系统，可手动切换并记住选择 ---------- */

	const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches:false, addListener(){}, removeListener(){} };
	const applyTheme = _=>{
		let dark = store.theme === 'dark' || (store.theme !== 'light' && darkMq.matches);
		document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
	};
	const setTheme = mode=>{
		store.theme = mode;
		saveStore();
		applyTheme();
	};
	const cycleTheme = _=>{
		setTheme(store.theme === 'auto' ? 'light' : store.theme === 'light' ? 'dark' : 'auto');
		return store.theme;
	};
	if(darkMq.addEventListener) darkMq.addEventListener('change', applyTheme);
	else if(darkMq.addListener) darkMq.addListener(applyTheme);
	applyTheme();

	/* ---------- 剪贴板 ---------- */

	const copyText = (text,onDone)=>{
		let done = ()=>{ onDone && onDone(true); };
		let fail = ()=>{
			try{
				let ta = document.createElement('textarea');
				ta.value = text;
				ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				ta.remove();
				done();
			}catch(e){ onDone && onDone(false); }
		};
		if(navigator.clipboard && navigator.clipboard.writeText){
			navigator.clipboard.writeText(text).then(done).catch(fail);
		}else{
			fail();
		}
	};

	/* ---------- 划词浮窗 ---------- */

	const getSelectionText = _=>{
		let text = getSelection().toString().trim();

		if(!!text && /[a-z0-9]/i.test(text)){
			return text;
		}else{
			return null;
		}
	};

	const fixPosition = _=>{
		let rect = getSelection().getRangeAt(0).getBoundingClientRect();

		const activeEl = document.activeElement;
		if(['TEXTAREA','INPUT'].includes(activeEl.tagName)) rect = activeEl.getBoundingClientRect();

		let scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

		let top  = Math.floor( scrollTop + rect.top +rect.height );
		let left = Math.floor( rect.left );

		if(top === 0 && left === 0){
			app.show = false;
		}
		app.top = Math.max(8, Math.min(top, scrollTop + window.innerHeight - 60));
		app.left = Math.max(8, Math.min(left, window.innerWidth - 356));
	};

	const timer = _=>{
		if(getSelectionText() || app.keepUntil > Date.now()){
			setTimeout(timer,300);
		}else{
			app.show = false;
		}
	};

	const tagCopyText = tag=>{
		if(tag.custom && tag.trans && tag.trans[0]) return tag.trans[0];
		if(store.choice[tag.name]) return store.choice[tag.name];
		if(tag.trans && tag.trans.length) return tag.trans[0];
		return '';
	};

	const nbnhhsh = _=>{
		let text = getSelectionText();

		app.show = !!text && /[a-z0-9]/i.test(text);

		if(!app.show){
			return;
		}

		app.activeIndex = 0;
		fixPosition();

		guess(text,data=>{
			if(!data.length){
				app.show = false;
			}else{
				app.tags = data;
			}
		});

		setTimeout(timer,300);
	};

	const _nbnhhsh = _=>{
		setTimeout(nbnhhsh,1);
	};

	document.body.addEventListener('mouseup',_nbnhhsh);
	document.body.addEventListener('keyup',e=>{
		// 浮窗显示时的上下键、回车、ESC 由浮窗自己处理，不重新查询
		if(app && app.show && ['ArrowUp','ArrowDown','Enter','Escape','Tab'].includes(e.key)) return;
		_nbnhhsh();
	});

	const createEl = html=>{
		createEl._el.innerHTML = html;
		let el = createEl._el.children[0];
		document.body.appendChild(el);
		return el;
	};
	createEl._el = document.createElement('div');

	createEl(`<style>${cssText}</style>`);

	const el = createEl(htmlText);

	const app = new Vue({
		el,
		data: {
			tags:[],
			show:false,
			loading:false,
			top:0,
			left:0,
			activeIndex:0,
			copiedName:'',
			keepUntil:0
		},
		watch:{
			show(val){ if(!val) this.copiedName = ''; }
		},
		methods:{
			submitTran,
			transArrange,
			copyTag(tag){
				let text = tagCopyText(tag);
				if(!text) return;
				copyText(text,ok=>{
					if(ok){
						this.copiedName = tag.name;
						this.keepUntil = Date.now() + 1500;
						setTimeout(_=>{
							if(this.copiedName === tag.name) this.copiedName = '';
						}, 1200);
					}
				});
			},
			toggleFav(tag){
				lib.toggleFav(tag.name);
				this.tags = this.tags.map(decorateTag);
			},
			onKeydown(e){
				if(!this.show) return;
				let n = this.tags.length;
				if(!n) return;
				if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
					e.preventDefault();
					e.stopPropagation();
					let d = e.key === 'ArrowDown' ? 1 : -1;
					this.activeIndex = (this.activeIndex + d + n) % n;
					let node = this.$el.querySelector('.nbnhhsh-tag-item.is-active');
					if(node) node.scrollIntoView({ block:'nearest' });
				}else if(e.key === 'Enter'){
					e.preventDefault();
					e.stopPropagation();
					this.copyTag(this.tags[this.activeIndex]);
				}else if(e.key === 'Escape'){
					e.preventDefault();
					e.stopPropagation();
					this.show = false;
				}
			}
		},
		created(){
			window.addEventListener('keydown', this.onKeydown, true);
			// 词库变化后刷新收藏/自定义状态
			this._unsub = onStoreChange(_=>{
				this.tags = this.tags.map(decorateTag);
			});
		}
	});

	try{ window.NbnhhshPopupApp = app; }catch(e){}

	return {
		API_URL,
		STORE_KEY,
		guess,
		submitTran,
		transArrange,
		lib,
		copyText,
		getCustom:_=>store.custom,
		getStore:_=>store,
		theme:{
			get value(){ return store.theme; },
			setTheme,
			cycleTheme,
			apply:_=>applyTheme()
		}
	}
})(
`
<div class="nbnhhsh-box nbnhhsh-box-pop" v-if="show" :style="{top:top+'px',left:left+'px'}" @mousedown.prevent>
	<div class="nbnhhsh-loading" v-if="loading">
		加载中…
	</div>
	<template v-else>
		<div class="nbnhhsh-pop-tip" v-if="tags.length>1">↑↓ 切换 · 回车复制 · 共 {{tags.length}} 条 · 点击结果可复制</div>
		<div class="nbnhhsh-tag-list">
			<div class="nbnhhsh-tag-item" :class="{'is-active':i===activeIndex}" v-for="(tag,i) in tags" :key="tag.name" @click="copyTag(tag)">
				<h4>{{tag.name}}<span class="nbnhhsh-fav" :class="{'is-fav':tag.fav}" @click.stop="toggleFav(tag)" :title="tag.fav?'取消收藏':'收藏'">★</span></h4>
				<div class="nbnhhsh-tran-list" v-if="tag.trans">
					<span class="nbnhhsh-tran-item" v-for="tran in transArrange(tag.trans)">
						{{tran.text}}<sub v-if="tran.sub">{{tran.sub}}</sub>
					</span>
				</div>
				<div class="nbnhhsh-notran-box" v-else-if="tag.trans===null">
					无对应文字
				</div>
				<div v-else-if="tag.inputting && tag.inputting.length !==0">
					<div class="nbnhhsh-inputting-list">
						<h5>有可能是</h5>
						<span class="nbnhhsh-inputting-item" v-for="input in tag.inputting">{{input}}</span>
					</div>
				</div>
				<div class="nbnhhsh-notran-box" v-else @click.prevent.stop="submitTran(tag.name)">
					尚未录入，我来提交对应文字
				</div>
				<a v-if="tag.trans!==null" @click.prevent.stop="submitTran(tag.name)" class="nbnhhsh-add-btn" title="我来提交对应文字"></a>
				<span class="nbnhhsh-copied" v-if="copiedName===tag.name">已复制</span>
			</div>
		</div>
	</template>
</div>
`, `
:root{
	--nb-pop-bg:#FFF;
	--nb-pop-color:#333;
	--nb-pop-sub-color:#777;
	--nb-pop-sub-bg:rgba(0,0,0,.07);
	--nb-pop-alt-bg:rgba(0,99,255,.06);
	--nb-pop-tip-bg:#eef4ff;
	--nb-pop-tip-color:#6b7a99;
	--nb-pop-active:rgba(0,89,255,.14);
	--nb-pop-link:#0059ff;
}
:root[data-theme="dark"]{
	--nb-pop-bg:#1f2127;
	--nb-pop-color:#e6e8ee;
	--nb-pop-sub-color:#9aa0ad;
	--nb-pop-sub-bg:rgba(255,255,255,.12);
	--nb-pop-alt-bg:rgba(64,132,255,.12);
	--nb-pop-tip-bg:#222c40;
	--nb-pop-tip-color:#9db4dd;
	--nb-pop-active:rgba(80,150,255,.28);
	--nb-pop-link:#6ea8ff;
}
.nbnhhsh-box{
	font:400 14px/1.4 sans-serif;
	color:var(--nb-pop-color);
}
.nbnhhsh-box-pop{
	position: absolute;
	z-index:99999999999;
	width: 340px;
	max-height:60vh;
	overflow-y:auto;
	background:var(--nb-pop-bg);
	color:var(--nb-pop-color);
	box-shadow: 0 3px 30px -4px rgba(0,0,0,.3);
	margin: 10px 0 100px 0;
	border-radius:6px;
}
.nbnhhsh-box-pop::before{
	content: '';
	position: absolute;
	top:-7px;
	left:8px;
	width: 0;
	height: 0;
	border:7px solid transparent;

	border-top:1px;
	border-bottom-color:var(--nb-pop-bg);
}
.nbnhhsh-pop-tip{
	font-size:12px;
	line-height:28px;
	padding:0 14px;
	background:var(--nb-pop-tip-bg);
	color:var(--nb-pop-tip-color);
	position:sticky;
	top:0;
}
.nbnhhsh-box sub{
	vertical-align: middle;
	background: var(--nb-pop-sub-bg);
	color: var(--nb-pop-sub-color);
	font-size: 12px;
	line-height:16px;
	display: inline-block;
	padding: 0 3px;
	margin:-2px 0 0 2px;
	border-radius: 2px;
	letter-spacing: -0.6px;
	bottom:0;
}
.nbnhhsh-tag-item{
	padding:4px 14px;
	position: relative;
	cursor:pointer;
}
.nbnhhsh-tag-item:nth-child(even){
	background: var(--nb-pop-alt-bg);
}
.nbnhhsh-tag-item.is-active{
	box-shadow: inset 3px 0 0 var(--nb-pop-link);
	background:var(--nb-pop-active);
}
.nbnhhsh-tag-item h4{
	font-weight:bold;
	font-size:20px;
	line-height:28px;
	letter-spacing: 1.5px;
	margin:0;
}
.nbnhhsh-fav{
	font-size:13px;
	margin-left:8px;
	color:#ccc;
	cursor:pointer;
	user-select:none;
}
.nbnhhsh-fav.is-fav{
	color:#f5a623;
}
.nbnhhsh-tran-list{
	color:var(--nb-pop-color);
	padding: 0 0 4px 0;
	line-height:18px;
	opacity:.92;
}
.nbnhhsh-tran-item{
	display: inline-block;
	padding: 2px 15px 2px 0;
}

.nbnhhsh-inputting-list{
	padding: 0 0 4px 0;
}
.nbnhhsh-inputting-list h5{
	font-size:12px;
	line-height:24px;
	color:var(--nb-pop-sub-color);
	margin:0;
}
.nbnhhsh-inputting-item{
	margin-right:14px;
	display:inline-block;
}
.nbnhhsh-notran-box{
	padding:4px 0;
	color:var(--nb-pop-sub-color);
	cursor: pointer;
}
.nbnhhsh-add-btn{
	position: absolute;
	top:0;
	right:0;
	width: 30px;
	line-height: 30px;
	text-align: center;
	color: var(--nb-pop-link);
	font-size: 16px;
	font-weight: bold;
	cursor: pointer;
}
.nbnhhsh-add-btn:after{
	content: '+';
}
.nbnhhsh-copied{
	position:absolute;
	right:10px;
	bottom:6px;
	font-size:12px;
	color:#2e9e5b;
	background:var(--nb-pop-bg);
	border-radius:4px;
	padding:0 4px;
}
.nbnhhsh-loading{
	text-align: center;
	color:var(--nb-pop-sub-color);
	padding:20px 0;
}
`);
