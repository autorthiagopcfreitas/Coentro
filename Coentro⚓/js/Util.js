class Util {
	constructor() {
		this.translationCache = new Map();
		this.translationCacheLoaded = false;
		this.translationCacheSaveTimer = null;
	}

	normalizeLanguageCode(value) {
		const raw = String(value || "").trim().toLowerCase();
		if (!raw) return "unknown";
		const compact = raw.replace(/_/g, "-");
		if (/^[a-z]{2,3}(-[a-z0-9]{2,4})*$/.test(compact)) {
			if (compact.startsWith("pt")) return "pt";
			if (compact.startsWith("en")) return "en";
			if (compact.startsWith("es")) return "es";
			if (compact.startsWith("fr")) return "fr";
			if (compact.startsWith("zh")) return "zh";
			if (compact.startsWith("hi")) return "hi";
			if (compact.startsWith("ar")) return "ar";
			if (compact.startsWith("bn")) return "bn";
			if (compact.startsWith("ru")) return "ru";
			if (compact.startsWith("ja")) return "ja";
		}
		const byName = {
			english: "en",
			ingles: "en",
			inglês: "en",
			portuguese: "pt",
			portugues: "pt",
			"português": "pt",
			spanish: "es",
			espanol: "es",
			español: "es",
			french: "fr",
			francais: "fr",
			français: "fr",
			chinese: "zh",
			zhongwen: "zh",
			arabic: "ar",
			"hindi": "hi",
			bengali: "bn",
			bangla: "bn",
			russian: "ru",
			russkiy: "ru",
			japanese: "ja",
			nihongo: "ja"
		};
		return byName[raw] || "unknown";
	}

	getLanguageLabel(code) {
		const normalized = this.normalizeLanguageCode(code);
		const labels = {
			en: "English",
			pt: "Português",
			es: "Español",
			fr: "Français",
			zh: "中文",
			hi: "हिन्दी",
			ar: "العربية",
			bn: "বাংলা",
			ru: "Русский",
			ja: "日本語",
			unknown: "Desconhecido"
		};
		return labels[normalized] || labels.unknown;
	}

	createElement(type, parent, className) {
		const elem = document.createElement(type);
		if (className) {
			elem.className = className;
		}
		if (parent) {
			parent.appendChild(elem);
		}
		return elem;
	}

	loadElem(query) {
		return document.querySelector(query);
	}

	loadAllElems(query, element) {
		return [...(element || document).querySelectorAll(query)];
	}

	loadStylesheet(url) {
		const current = this.loadAllElems("link");

		if (current.find(link => link.href === url)) {
			return;
		}

		const link = document.createElement("link");
		link.href = url;
		link.rel = "stylesheet";
		document.head.appendChild(link);
	}

	removeStylesheet(url) {
		this.loadAllElems("link").filter(link => link.href.endsWith(url)).forEach(link => link.remove());
	}

	setTitle(title) {
		document.title = title;
	}

	getReadPercentage(data, chapter, anchor) {
		if (!Array.isArray(data) || !data.length) {
			return 0;
		}
		const total = data.reduce((acc, val) => acc + (val?.textLength || 0), 0);
		let read = 0;
		const selector = "p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div, figure, img, image, svg";

		for (let i = 0; i < data.length; i++) {
			if (i < chapter) {
				read += data[i]?.textLength || 0;
				continue;
			}

			const elem = document.createElement("div");
			elem.innerHTML = data[i]?.innerHTML || "";
			const children = [...elem.querySelectorAll(selector)].filter(child => {
				const text = (child.textContent || "").trim();
				if (text.length > 0) return true;
				const isMediaElem = child.tagName === "IMG" || child.tagName === "IMAGE" || child.tagName === "SVG" || child.tagName === "FIGURE";
				const hasMediaChild = !!child.querySelector?.("img, image, svg");
				return isMediaElem || hasMediaChild;
			});
			for (let j = 0; j < children.length; j++) {
				if (j <= anchor) {
					read += children[j].innerText.length;
				}
			}
			break;
		}

		if (total <= 0) return 0;
		return read / total * 100;
	}

	copyToClipboard(text) {
		if (!navigator.clipboard) {
			return;
		}

		navigator.clipboard.writeText(text);
	}

	capText(text, length) {
		if (text.length > length) {
			return text.substring(0, length) + "...";
		}

		return text;
	}

	extractIsbn(text) {
		if (!text) {
			return null;
		}

		const matches = text.match(/[0-9Xx][0-9Xx-\s]{8,16}[0-9Xx]/g) || [];
		for (const match of matches) {
			const cleaned = match.replace(/[^0-9Xx]/g, "").toUpperCase();
			if (cleaned.length === 10 || cleaned.length === 13) {
				return cleaned;
			}
		}

		return null;
	}

	getGoodreadsUrl(book) {
		if (!book) {
			return "https://www.goodreads.com";
		}

		const identifier = book.attributes ? (book.attributes["Identifier"] || book.attributes["ISBN"]) : null;
		const isbn = this.extractIsbn(identifier || "");
		if (isbn) {
			return `https://www.goodreads.com/book/isbn/${isbn}`;
		}

		const author = book.attributes ? (book.attributes["Creator"] || "") : "";
		const query = encodeURIComponent(`${book.title || ""} ${author}`.trim());
		return `https://www.goodreads.com/search?q=${query}`;
	}

	getBookIdentityKey(book) {
		const normalize = value => String(value || "")
			.trim()
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^\w]+/g, "_")
			.replace(/^_+|_+$/g, "");
		const attrs = book?.attributes || {};
		const idRaw = attrs.Identifier || attrs.identifier || attrs.ISBN || attrs.isbn || attrs["dc:identifier"] || "";
		const isbn = this.extractIsbn(String(idRaw || ""));
		const idPart = normalize(isbn || idRaw);
		const titlePart = normalize(book?.title || "");
		const authorPart = normalize(attrs.Creator || attrs.creator || "");
		return `${titlePart}__${authorPart}__${idPart}`;
	}

	getRelativePath(originalFilePath, targetFilePath) {
		const originalSegments = originalFilePath.split("/");
		const targetSegments = targetFilePath.split("/");

		originalSegments.pop();

		while (originalSegments.length > 0 && targetSegments[0] === "..") {
			originalSegments.pop();
			targetSegments.shift();
		}

		const finalSegments = originalSegments.concat(targetSegments);

		return finalSegments.join("/");
	}

	getDateString(date) {
		return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
	}

	async sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async ensureTranslationCacheLoaded() {
		if (this.translationCacheLoaded) {
			return;
		}
		this.translationCacheLoaded = true;
		try {
			const persisted = await reader?.store?.get("translationCacheV1");
			if (!persisted || typeof persisted !== "object") {
				return;
			}
			Object.entries(persisted).forEach(([key, value]) => {
				if (typeof value === "string") {
					this.translationCache.set(key, value);
				}
			});
		} catch (_error) {}
	}

	scheduleTranslationCacheSave() {
		window.clearTimeout(this.translationCacheSaveTimer);
		this.translationCacheSaveTimer = window.setTimeout(async () => {
			try {
				const MAX_CACHE_ITEMS = 5000;
				const entries = [...this.translationCache.entries()].slice(-MAX_CACHE_ITEMS);
				await reader?.store?.set("translationCacheV1", Object.fromEntries(entries));
			} catch (_error) {}
		}, 800);
	}

	async getTranslationConfig() {
		const provider = (await reader?.store?.loadSetting("translationProvider")) || "google";
		const apiKey = (await reader?.store?.loadSetting("translationApiKey")) || "";
		const apiUrl = (await reader?.store?.loadSetting("translationApiUrl")) || "http://127.0.0.1:8000/translate";
		const model = (await reader?.store?.loadSetting("translationModel")) || "facebook/nllb-200-distilled-600M";
		return {
			provider,
			apiKey: String(apiKey || "").trim(),
			apiUrl: String(apiUrl || "").trim(),
			model: String(model || "").trim()
		};
	}

	async translateViaGoogle(text, targetLang, sourceLang = "auto") {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Google translate HTTP ${response.status}`);
		}
		const payload = await response.json();
		if (!Array.isArray(payload?.[0])) {
			return text;
		}
		const translated = payload[0]
			.map(item => (Array.isArray(item) ? (item[0] || "") : ""))
			.join("");
		return translated || text;
	}

	async translateViaHFSelfHostBatch(texts, targetLang, sourceLang = "auto", config = {}) {
		const batch = Array.isArray(texts) ? texts : [texts];
		const sourceList = batch.map(item => String(item ?? ""));
		const endpoint = config.apiUrl || "http://127.0.0.1:8000/translate";
		const headers = { "Content-Type": "application/json" };
		if (config.apiKey) {
			headers.Authorization = `Bearer ${config.apiKey}`;
		}
		const body = {
			texts: sourceList,
			source_lang: sourceLang,
			target_lang: targetLang,
			model: config.model || "facebook/nllb-200-distilled-600M"
		};
		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			throw new Error(`HF self-host HTTP ${response.status}`);
		}
		const payload = await response.json();
		if (Array.isArray(payload?.translations)) {
			return payload.translations.map((item, idx) => String(item || sourceList[idx] || ""));
		}
		if (Array.isArray(payload)) {
			return payload.map((item, idx) => String(item || sourceList[idx] || ""));
		}
		if (typeof payload?.translatedText === "string") {
			return [payload.translatedText];
		}
		return sourceList;
	}

	async translateText(text, targetLang, sourceLang = "auto") {
		const raw = String(text ?? "");
		if (!raw.trim() || !targetLang) {
			return raw;
		}

		await this.ensureTranslationCacheLoaded();
		const config = await this.getTranslationConfig();
		const cacheKey = `${config.provider}:${sourceLang}->${targetLang}::${raw}`;
		if (this.translationCache.has(cacheKey)) {
			return this.translationCache.get(cacheKey);
		}

		try {
			let translated = raw;
			if (config.provider === "hf-selfhost") {
				try {
					const list = await this.translateViaHFSelfHostBatch([raw], targetLang, sourceLang, config);
					translated = list[0] || raw;
				} catch (_hfError) {
					translated = await this.translateViaGoogle(raw, targetLang, sourceLang);
				}
			} else {
				translated = await this.translateViaGoogle(raw, targetLang, sourceLang);
			}
			const safe = translated || raw;
			this.translationCache.set(cacheKey, safe);
			this.scheduleTranslationCacheSave();
			return safe;
		} catch (_error) {
			return raw;
		}
	}

	async translateTextList(texts, targetLang, sourceLang = "auto") {
		const unique = [...new Set((texts || []).map(item => String(item ?? "")).filter(item => item.trim()))];
		const translatedBySource = new Map();
		const config = await this.getTranslationConfig();
		if (config.provider === "hf-selfhost" && unique.length) {
			await this.ensureTranslationCacheLoaded();
			const uncached = [];
			for (const sourceText of unique) {
				const cacheKey = `${config.provider}:${sourceLang}->${targetLang}::${sourceText}`;
				if (this.translationCache.has(cacheKey)) {
					translatedBySource.set(sourceText, this.translationCache.get(cacheKey));
				} else {
					uncached.push(sourceText);
				}
			}
			if (uncached.length) {
				try {
					const translatedBatch = await this.translateViaHFSelfHostBatch(uncached, targetLang, sourceLang, config);
					uncached.forEach((sourceText, idx) => {
						const translated = String(translatedBatch[idx] || sourceText);
						const cacheKey = `${config.provider}:${sourceLang}->${targetLang}::${sourceText}`;
						this.translationCache.set(cacheKey, translated);
						translatedBySource.set(sourceText, translated);
					});
					this.scheduleTranslationCacheSave();
				} catch (_error) {
					const CONCURRENCY = 4;
					let index = 0;
					const workers = new Array(CONCURRENCY).fill(null).map(async () => {
						while (index < uncached.length) {
							const current = uncached[index];
							index += 1;
							let translated = current;
							try {
								translated = await this.translateViaGoogle(current, targetLang, sourceLang);
							} catch (_googleError) {}
							const safeTranslated = String(translated || current);
							const cacheKey = `${config.provider}:${sourceLang}->${targetLang}::${current}`;
							this.translationCache.set(cacheKey, safeTranslated);
							translatedBySource.set(current, safeTranslated);
						}
					});
					await Promise.all(workers);
					this.scheduleTranslationCacheSave();
				}
			}
			return translatedBySource;
		}
		const CONCURRENCY = 6;
		let index = 0;
		const workers = new Array(CONCURRENCY).fill(null).map(async () => {
			while (index < unique.length) {
				const current = unique[index];
				index += 1;
				translatedBySource.set(current, await this.translateText(current, targetLang, sourceLang));
			}
		});
		await Promise.all(workers);
		for (const sourceText of unique) {
			if (!translatedBySource.has(sourceText)) {
				translatedBySource.set(sourceText, sourceText);
			}
		}
		return translatedBySource;
	}

	async translateDomTree(root, targetLang, options = {}) {
		if (!root || !targetLang) {
			return;
		}

		const excludeSelectors = options.excludeSelectors || ["script", "style", "noscript", "#pageContent", "#readerLinear"];
		const maxNodes = Number(options.maxNodes) > 0 ? Number(options.maxNodes) : 1200;
		const isTranslatableText = value => {
			const text = String(value ?? "");
			if (!text.trim()) {
				return false;
			}
			// Skip values with only numbers/punctuation to avoid wasted translation calls.
			if (/^[\s\d.,:%\-–—/()[\]{}+*_=|\\]+$/.test(text)) {
				return false;
			}
			return true;
		};
		const shouldExclude = elem => !!(
			elem &&
			elem.closest &&
			(elem.closest("[data-no-auto-translate='true']") || excludeSelectors.some(selector => elem.closest(selector)))
		);

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: node => {
				if (!node || !isTranslatableText(node.nodeValue)) {
					return NodeFilter.FILTER_REJECT;
				}
				const parent = node.parentElement;
				if (!parent || shouldExclude(parent)) {
					return NodeFilter.FILTER_REJECT;
				}
				if (parent.dataset && parent.dataset.translatedLang === targetLang) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes = [];
		while (walker.nextNode() && textNodes.length < maxNodes) {
			textNodes.push(walker.currentNode);
		}

		const sourceTexts = textNodes.map(node => node.nodeValue);
		const translatedMap = await this.translateTextList(sourceTexts, targetLang);
		textNodes.forEach(node => {
			const source = node.nodeValue;
			const translated = translatedMap.get(source);
			if (!translated || translated === source) {
				return;
			}
			node.nodeValue = translated;
			if (node.parentElement?.dataset) {
				node.parentElement.dataset.translatedLang = targetLang;
			}
		});

		const attributeTargets = [...root.querySelectorAll("[placeholder], [title], [aria-label], option")];
		const attributeJobs = [];
		const attributeTexts = [];
		for (const elem of attributeTargets) {
			if (shouldExclude(elem)) {
				continue;
			}
			if (elem.dataset && elem.dataset.translatedLang === targetLang) {
				continue;
			}
			for (const attrName of ["placeholder", "title", "aria-label"]) {
				const current = elem.getAttribute(attrName);
				if (!isTranslatableText(current)) {
					continue;
				}
				attributeJobs.push({ elem, type: "attr", attrName, source: current });
				attributeTexts.push(current);
			}
			if (elem.tagName === "OPTION") {
				const optionText = elem.textContent || "";
				if (isTranslatableText(optionText)) {
					attributeJobs.push({ elem, type: "option", source: optionText });
					attributeTexts.push(optionText);
				}
			}
		}
		const translatedAttributes = await this.translateTextList(attributeTexts, targetLang);
		for (const job of attributeJobs) {
			const translated = translatedAttributes.get(job.source);
			if (!translated || translated === job.source) {
				continue;
			}
			if (job.type === "attr") {
				job.elem.setAttribute(job.attrName, translated);
			} else if (job.type === "option") {
				job.elem.textContent = translated;
			}
		}
		for (const elem of attributeTargets) {
			if (elem.dataset && !shouldExclude(elem)) {
				elem.dataset.translatedLang = targetLang;
			}
		}
	}

	async translateHtmlPreservingMarkup(html, targetLang) {
		const sourceHtml = String(html || "");
		if (!sourceHtml.trim() || !targetLang) {
			return sourceHtml;
		}
		const wrapper = document.createElement("div");
		wrapper.innerHTML = sourceHtml;
		await this.translateDomTree(wrapper, targetLang, {
			excludeSelectors: ["script", "style", "noscript"],
			maxNodes: 10000
		});
		return wrapper.innerHTML;
	}
}

HTMLElement.prototype.setAttributes = function(attributes) {
	for (const attribute in attributes) {
		this.setAttribute(attribute, attributes[attribute]);
	}

	return this;
}

HTMLElement.prototype.applyStyles = function(styles) {
	for (const style in styles) {
		this.style[style] = styles[style];
	}

	return this;
}

HTMLElement.prototype.clear = function() {
	this.innerHTML = "";
}

HTMLElement.prototype.show = function(style) {
	this.style.display = style || "block";
}

HTMLElement.prototype.hide = function() {
	this.style.display = "none";
}
