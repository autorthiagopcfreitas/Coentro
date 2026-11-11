class Renderer {
	constructor(settings) {
		this.settings = settings;
		this.book = null;
		this.position = null;
		this.container = null;
		this.overlay = null;

		this.page = 0;
		this.spreadElem = null;
		this.pageContainer = null;
		/** ConteÃƒÂºdo largo em fluxo normal; multi-coluna aplicada aqui para a largura ser respeitada (evita coluna direita vazia). */
		this.pageContent = null;
		this.chapterHTML = null;
		this.endCardHTML = null;

		this.listeners = [];
		this.overlayTimeout = null;
		this.tooltipTimeout = null;
		this.loading = false;
		this.positionSaveTimeout = null;
		this.readerStylesheet = null;
		this.lastPageTime = null;
		this.lastTrackedAnchor = 0;
		this.lastTrackedChapter = 0;
		this.columnMarkers = null;
		this.columnMarkerItems = [];
		this.columnMarkersTimeout = null;
		this.pageNumbers = null;
		this.pageNumberItems = [];
		this.readingTimer = null;
		this.immersiveActiveUntil = 0;
		this.lastReadingTick = null;
		this.lastActivity = null;
		this.navHideTimeouts = { left: null, right: null };
		this.navEdgesHideTimeout = null;
		this.navVisible = { left: false, right: false };
		this.navAutoHideMs = 5000;
		this.showNavArrows = true;
		this.tapToNavigate = true;
		this.navDocumentMouseMoveHandler = null;
		this.navDocumentMouseLeaveHandler = null;
		this.navToastCounts = { left: 0, right: 0 };
		this.navToastTimers = { left: null, right: null };
		this.immersiveReaderObserver = null;
		this.immersiveObserverSyncTimer = null;
		this.immersiveCloneViewportTimer = null;
		this.linearSyncTimer = null;
		this.linearSyncBusy = false;
		this.pageObserver = null;
		this.pageSentinelVisibility = new Map();
		this.lastPageObserverUpdateAt = 0;
		this.userInteractionLockUntil = 0;
		this.manualNavLockUntil = 0;
		this.disableHighlightUntil = 0;
		this.lastMirrorKey = "";
		this.autoPageAdvanceHandler = null;
		this.lastAutoPageAdvance = 0;
		this.autoPageAdvanceTimer = null;
		this.keyNavigationHandler = null;
		this.selectionSyncLockUntil = 0;
		this.lastSelectionSyncSignature = "";
		this.lastSelectionSyncAt = 0;
		this.lastSelectionDrivenSyncAt = 0;
		this.lastImmersiveAdvancePage = -1;
		this.lastImmersiveAdvanceAt = 0;
		this.lastImmersivePageMarkerKey = "";
		this.viewportSyncBusy = false;
		this.viewportSyncLockUntil = 0;
		this.pageSyncSeq = 0;
		this.fullscreenTransitionLockUntil = 0;
		this.fullscreenPageSnapshot = null;
		this.allowDetachedImmersiveMode = false;
		this.navQueue = [];
		this.navQueueActive = false;
		this.pageViewMode = "two";
		this.readerMarginPx = 50;
		this.themeMode = "light";
		this.textColor = "#1a1a1a";
		this.backgroundColor = "#ff7a3d";
		this.savedImmersiveWord = null;
		this.immersiveWordSaveTimeout = null;
		this.lastImmersiveWordKey = "";
		this.readingStateSaveTimeout = null;
		this.positionPersistTimeout = null;
		this.pendingPositionState = null;
		this.selectionCaptureTimer = null;
		this.searchDebounceTimeout = null;
		this.searchKeyHandler = null;
		this.searchOptionHandler = null;
		this.searchMatches = [];
		this.searchMatchNodes = [];
		this.activeSearchMatchIndex = -1;
		this.searchLimitReached = false;
		this.searchOrderedResults = [];
		this.activeSearchResultIndex = -1;
		this.pendingReaderSearchState = null;
		this.synopsisSidebarWidth = "one-third";
		this.synopsisSidebarVisible = false;
		this.synopsisSidebarElem = null;
		this.synopsisSidebarBodyElem = null;
		this.synopsisSidebarStatusElem = null;
		this.synopsisFetchController = null;
		this.synopsisFetchCache = null;
		this.tocAnchorMap = [];
		this.anchorTextIndexCache = new WeakMap();
		this.stableAnchorElementsCache = new WeakMap();
		this.immersiveSyncFrame = 0;
		this.immersiveSelectionSyncPending = false;
		this.lastQueuedImmersiveSyncMode = "";
		this.contentLinkHandler = this.onContentLinkClick.bind(this);
	}

	/** EspaÃƒÂ§o reservado no topo (cabeçalho) para cálculo da altura visÃƒÂ­vel */
	static RESERVED_TOP = 0;
	/** Espaço reservado na base (rodapé) para não sobrepor texto */
	static RESERVED_BOTTOM = 0;
	/** Margem vertical interna da página (estilo Kindle/Kobo) */
	static PAGE_VERTICAL_PADDING = 50;
	static TTS_PAGE_FLOW_OFFSET_RATIO = 0.12;
	/** Altura reservada para overlay (topo + rodapé), para que o texto nÃƒÂ£o fique sob a barra */
	getReadableAreaOffset() {
		return Renderer.RESERVED_TOP + Renderer.RESERVED_BOTTOM;
	}

	getColumnCount() {
		const readerElem = reader.util.loadElem("#reader");
		const w = readerElem ? readerElem.clientWidth : 0;
		if (this.pageViewMode === "one") {
			return 1;
		}
		if (this.pageViewMode === "two") {
			return w >= 760 ? 2 : 1;
		}
		if (this.pageViewMode === "three") {
			return 3;
		}
		if (this.pageViewMode === "four") {
			return 4;
		}
		return w >= 1000 ? 2 : 1;
	}

	getNavigationStep(direction = "next") {
		const colCount = this.getColumnCount();
		// In 3/4-column modes, move one page at a time through the first 2 transitions
		// (cover/front-matter), then return to normal spread jumps.
		if (this.pageViewMode === "three" || this.pageViewMode === "four") {
			if (direction === "next" && this.page < 2) return 1;
			if (direction === "prev" && this.page <= 2) return 1;
		}
		return colCount;
	}

	/** Altura visí­vel útil para as duas páginas (sem sobreposição do overlay) */
	getEffectiveViewHeight() {
		const h = this.container?.clientHeight || 600;
		return Math.max(200, h - Renderer.RESERVED_TOP - Renderer.RESERVED_BOTTOM);
	}

	getReaderThemePresets() {
		return {
			light: { key: "light", themeMode: "light", textColor: "#1e2430", backgroundColor: "#f1f0eb" },
			sepia: { key: "sepia", themeMode: "light", textColor: "#6f4e37", backgroundColor: "#e9dcc6" },
			dark: { key: "dark", themeMode: "dark", textColor: "#f3efe7", backgroundColor: "#23211f" },
			night: { key: "night", themeMode: "dark", textColor: "#dde4f2", backgroundColor: "#202331" },
			aurora: { key: "aurora", themeMode: "dark", textColor: "#f5ecff", backgroundColor: "#3b1b49" }
		};
	}

	getReaderThemePreset(key) {
		const presets = this.getReaderThemePresets();
		const normalized = String(key || "").trim().toLowerCase();
		return presets[normalized] || presets.night;
	}

	resolveReaderAppearance(settings = {}) {
		const preset = this.getReaderThemePreset(settings.readerThemePreset || settings.theme || "night");
		const source = settings.readerColorSource === "preset" ? "preset" : "custom";
		const themeMode = source === "preset"
			? preset.themeMode
			: (typeof settings.themeMode === "string" && settings.themeMode ? settings.themeMode : preset.themeMode);
		return {
			themeMode,
			textColor: source === "preset"
				? preset.textColor
				: (settings.textColor || (themeMode === "dark" ? "#ffffff" : "#000000")),
			backgroundColor: source === "preset"
				? preset.backgroundColor
				: (settings.backgroundColor || (themeMode === "dark" ? "#000000" : "#ffffff"))
		};
	}

	async load(book, position) {
		this.book = book;
		this.position = position;
		this.readerStylesheet = reader.util.createElement("style", document.head);
		this.lastPageTime = new Date().getTime();
		this.lastReadingTick = this.lastPageTime;
		this.lastActivity = this.lastPageTime;

		const showNavArrowsSetting = await reader.store.loadSetting("showNavArrows");
		const tapToNavigateSetting = await reader.store.loadSetting("tapToNavigate");
		this.showNavArrows = showNavArrowsSetting === false ? false : true;
		this.tapToNavigate = tapToNavigateSetting === null ? true : !!tapToNavigateSetting;
		this.pageViewMode = (await reader.store.loadSetting("pageViewMode")) || "two";
		this.hideOceanPdfWatermark = !!(await reader.store.loadSetting("hideOceanPdfWatermark"));
		this.readerMarginPx = Math.max(20, Math.min(100, Number(await reader.store.loadSetting("readerMargin")) || 50));
		const appearance = this.resolveReaderAppearance({
			theme: await reader.store.loadSetting("theme"),
			themeMode: (await reader.store.loadSetting("themeMode")) || "light",
			textColor: await reader.store.loadSetting("textColor"),
			backgroundColor: await reader.store.loadSetting("backgroundColor"),
			readerColorSource: await reader.store.loadSetting("readerColorSource"),
			readerThemePreset: await reader.store.loadSetting("readerThemePreset")
		});
		this.themeMode = appearance.themeMode;
		this.textColor = appearance.textColor;
		this.backgroundColor = appearance.backgroundColor;
		this.savedImmersiveWord = null;

		await this.loadFullBook(this.position.chapter ?? 0, this.position.anchor ?? 0);
		if ((Number(this.position.globalAnchor) || 0) > 0) {
			const globalAnchor = Math.max(0, Number(this.position.globalAnchor) || 0);
			this.page = await this.getPageFromAnchor(globalAnchor);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if ((Number(this.position.chapterGlobalAnchor) || 0) > 0) {
			const chapterGlobalAnchor = Math.max(0, Number(this.position.chapterGlobalAnchor) || 0);
			this.page = await this.getPageFromAnchor(chapterGlobalAnchor);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if ((Number(this.position.page) || 0) > 0) {
			this.page = Math.max(0, Number(this.position.page) || 0);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if (this.position.anchor !== 0 || this.position.chapter !== 0) {
			this.page = await this.getPageFromAnchor(this.position.anchor ?? 0);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
		}
		await this.onResize(true);
		this.clearImmersiveWordMarker();
		this.startSelectionCapture();
		
		// Monitorar mudanças no DOM causadas pelo Immersive Reader e garantir que o overflow seja respeitado
		this.setupImmersiveReaderObserver();
		this.listeners.push(["resize", reader.inputManager.addListener("resize", this.onResize.bind(this))]);
		this.listeners.push(["mousemove", reader.inputManager.addListener("mousemove", this.onMouseMove.bind(this))]);
		this.listeners.push(["keydown", reader.inputManager.addListener("keydown", this.onUserActivity.bind(this))]);
		this.listeners.push(["wheel", reader.inputManager.addListener("wheel", this.onUserActivity.bind(this))]);
		this.listeners.push(["touchstart", reader.inputManager.addListener("touchstart", this.onUserActivity.bind(this))]);
		this.listeners.push(["mousedown", reader.inputManager.addListener("mousedown", this.onUserActivity.bind(this))]);
		this.listeners.push(["mousedown", reader.inputManager.addListener("mousedown", this.onUserInteraction.bind(this))]);
		this.listeners.push(["mouseup", reader.inputManager.addListener("mouseup", this.onUserInteraction.bind(this))]);
		this.listeners.push(["selectionchange", this.onSelectionChange.bind(this)]);
		this.listeners.push(["mousedown", reader.inputManager.addListener("mousedown", this.lockPageTransitions.bind(this))]);
		this.listeners.push(["mouseup", reader.inputManager.addListener("mouseup", this.lockPageTransitions.bind(this))]);
		this.listeners.push(["click", reader.inputManager.addListener("click", this.onReaderTap.bind(this))]);
		this.listeners.push(["visibilitychange", reader.inputManager.addListener("visibilitychange", this.onVisibilityChange.bind(this))]);
		this.listeners.push(["fullscreenchange", reader.inputManager.addListener("fullscreenchange", this.onFullscreenChange.bind(this))]);
		this.listeners.push(["beforeunload", reader.inputManager.addListener("beforeunload", this.onBeforeUnload.bind(this))]);
		this.listeners.push(["pagehide", reader.inputManager.addListener("pagehide", this.onBeforeUnload.bind(this))]);
		this.listeners.push(["blur", reader.inputManager.addListener("blur", this.onBeforeUnload.bind(this))]);
		this.listeners.push(["focus", reader.inputManager.addListener("focus", this.onUserActivity.bind(this))]);
		this.listeners.push([null, reader.inputManager.onKeys(["ArrowLeft", "ArrowUp"], () => this.queueNavClick("prev"))]);
		this.listeners.push([null, reader.inputManager.onKeys(["ArrowRight", "ArrowDown", " "], () => this.queueNavClick("next"))]);
		this.listeners.push([null, reader.inputManager.onKeys(["p"], () => this.queueNavClick("prev"))]);
		this.listeners.push([null, reader.inputManager.onKeys(["n"], () => this.queueNavClick("next"))]);
		this.listeners.push([null, reader.inputManager.onKeys(["d"], this.goToPrevChapter.bind(this))]);
		this.listeners.push([null, reader.inputManager.onKeys(["k"], this.goToNextChapter.bind(this))]);
		this.listeners.push([null, reader.inputManager.onKeys(["b"], this.goToBeginning.bind(this))]);
		this.listeners.push([null, reader.inputManager.onKeys(["e"], this.goToEnd.bind(this))]);
		this.listeners.push([null, reader.inputManager.onKeys(["f"], this.toggleFullscreen.bind(this))]);
		this.keyNavigationHandler = this.onNavigationKey.bind(this);
		window.addEventListener("keydown", this.keyNavigationHandler, true);
		this.setupReaderSearch();

		reader.util.loadElem("#readerOverlayTopText").innerHTML = `${this.book.title} &ndash; ${this.book.attributes["Creator"]}`;

		reader.util.loadElem("#overlayProgress").addEventListener("mousemove", this.overlayProgressMouseMove.bind(this));

		this.ensureNavEdges();
		if (this.showNavArrows) {
			this.showNavEdge("left");
			this.showNavEdge("right");
			this.scheduleHideNavEdges();
		}
		if (!this.navDocumentMouseMoveHandler) {
			this.navDocumentMouseMoveHandler = () => {
				if (!this.showNavArrows || !this.book) return;
				this.showNavEdge("left");
				this.showNavEdge("right");
				this.scheduleHideNavEdges();
			};
			window.addEventListener("mousemove", this.navDocumentMouseMoveHandler, true);
			document.addEventListener("mousemove", this.navDocumentMouseMoveHandler, true);
		}
		if (!this.navDocumentMouseLeaveHandler) {
			this.navDocumentMouseLeaveHandler = () => this.scheduleHideNavEdges();
			document.addEventListener("mouseleave", this.navDocumentMouseLeaveHandler, true);
		}
		reader.util.loadElem("#overlayProgress").addEventListener("click", this.overlayProgressClick.bind(this));

		const navLeft = reader.util.loadElem("#readerNavLeft");
		if (navLeft) {
			navLeft.addEventListener("mousedown", event => {
				event.preventDefault();
				event.stopPropagation();
				this.queueNavClick("prev");
			});
			navLeft.addEventListener("touchstart", event => {
				event.preventDefault();
				event.stopPropagation();
				this.queueNavClick("prev");
			}, { passive: false });
			navLeft.addEventListener("click", event => {
				event.preventDefault();
				event.stopPropagation();
			});
		}

		const navRight = reader.util.loadElem("#readerNavRight");
		if (navRight) {
			navRight.addEventListener("mousedown", event => {
				event.preventDefault();
				event.stopPropagation();
				this.queueNavClick("next");
			});
			navRight.addEventListener("touchstart", event => {
				event.preventDefault();
				event.stopPropagation();
				this.queueNavClick("next");
			}, { passive: false });
			navRight.addEventListener("click", event => {
				event.preventDefault();
				event.stopPropagation();
			});
		}

		this.startReadingTimer();
	}

	/** Unionized book: one DOM, all chapters. No per-chapter load; Immersive Reader reads start to end. */
	async loadFullBook(initialChapter, initialAnchor) {
		this.container.clear();
		if (this.columnMarkers) {
			this.columnMarkers.remove();
		}
		this.columnMarkers = null;
		this.columnMarkerItems = [];
		this.position.chapter = initialChapter ?? 0;
		this.page = 0;

		this.loading = true;
		reader.util.loadElem("#readerLoading").show("flex");

		this.endCardHTML = `<div id="goodreadsEndCard"><div class="goodreadsEndCardTitle">Fim do livro</div><button id="goodreadsEndButton" class="goodreadsButton goodreads-read">Read</button></div>`;

		// Paged view: all chapters; CSS + optional pad blocks align chapter starts to spread boundaries.
		const pagedParts = this.book.contents.map((ch, i) => {
			const html = (ch && ch.innerHTML != null) ? this.sanitizeChapterHtml(String(ch.innerHTML)) : "";
			return `<div class="chapter-block" data-chapter-index="${i}"><div class="chapter-start-anchor" aria-hidden="true" role="presentation"></div>${html}</div>`;
		});
		this.loadAllChapterStyles();

		const spread = reader.util.createElement("div", this.container).setAttributes({
			id: "readerSpread"
		});
		this.spreadElem = spread;
		this.pageContainer = reader.util.createElement("div", spread).setAttributes({ id: "pageContainer" });
		this.pageContainer.applyStyles({ "overflow": "hidden", "position": "relative", "width": "100%", "minHeight": "100%", "height": "100%" });
		this.pageContent = reader.util.createElement("div", this.pageContainer).setAttributes({ id: "pageContent" });
		this.invalidateAnchorCaches();
		this.pageContent.innerHTML = pagedParts.join("") + this.endCardHTML;
		this.pageContent.addEventListener("click", this.contentLinkHandler, true);
		this.pageContent.style.visibility = "hidden";
		this.spreadElem.applyStyles({ "overflow": "hidden", "position": "relative", "width": "100%", "minHeight": "100%", "height": "100%" });

		this.ensureColumnMarkers();
		this.ensurePageNumbers();
		this.createChapterMarkers(Array.isArray(this.book?.chapterPoints) ? this.book.chapterPoints : []);
		await new Promise(r => requestAnimationFrame(r));
		await this.onResize(true);
		this.ensureReadableChapterText();
		await this.applyChapterPageAlignment();
		this.invalidateAnchorCaches();

		// Single document for Immersive Reader: full book, no structural boundaries.
		const linearParts = this.book.contents.map((ch, i) => {
			const html = (ch && ch.innerHTML != null) ? this.sanitizeHtmlForLinearReading(this.sanitizeChapterHtml(String(ch.innerHTML))) : "";
			return `<div class="chapter-block" data-chapter-index="${i}"><div class="chapter-start-anchor" aria-hidden="true" role="presentation"></div>${html}</div>`;
		});
		const linearHtml = linearParts.join("") + this.endCardHTML;
		let linearEl = reader.util.loadElem("#readerLinear");
		if (!linearEl) {
			linearEl = reader.util.createElement("div", this.container);
			linearEl.setAttributes({ id: "readerLinear" });
		}
		linearEl.innerHTML = linearHtml;
		this.ensureReadableChapterText(linearEl);
		this.spreadElem.setAttribute("aria-hidden", "true");

		this.chapterAnchorOffsets = this.computeChapterAnchorOffsets();
		this.buildTocAnchorMap();

		// First open: force start at page 0. Otherwise restore by saved page, fallback to chapter + anchor.
		const isFirstOpen = this.position && this.position.isFirstOpen === true;
		const shouldStartAtBeginning = (this.position && this.position.forceBeginning === true) || isFirstOpen;
		if (shouldStartAtBeginning) {
			this.position.chapter = 0;
			this.position.anchor = 0;
			this.page = 0;
		} else if ((Number(this.position?.globalAnchor) || 0) > 0) {
			const globalAnchor = Math.max(0, Number(this.position.globalAnchor) || 0);
			this.position.anchor = globalAnchor;
			this.page = await this.getPageFromAnchor(globalAnchor);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if ((Number(this.position?.chapterGlobalAnchor) || 0) > 0) {
			const chapterGlobalAnchor = Math.max(0, Number(this.position.chapterGlobalAnchor) || 0);
			this.position.anchor = chapterGlobalAnchor;
			this.page = await this.getPageFromAnchor(chapterGlobalAnchor);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if ((Number(this.position?.page) || 0) > 0) {
			this.page = Math.max(0, Number(this.position.page) || 0);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else if ((Number(this.position?.pagePercentage) || 0) > 0) {
			const maxPage = Math.max(0, await this.getMaxPage());
			this.page = this.getPageFromPercentage(this.position.pagePercentage, maxPage);
		this.applyPageOffset();
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		} else {
			const safeAnchor = Math.max(0, Number(initialAnchor) ?? 0);
			const globalAnchor = this.getGlobalAnchorIndex(this.position.chapter, safeAnchor);
			this.position.anchor = globalAnchor;
			this.page = await this.getPageFromAnchor(globalAnchor);
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		}
		this.applyPageOffset();
		this.pageContent.style.visibility = "visible";
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		const current = this.getCurrentChapterAndAnchor();
		const currentPct = reader.util.getReadPercentage(this.book.contents, current.chapter, current.anchor);
		this.updateOverlayProgressInfo(current.chapter, current.anchor, currentPct);
		const marker = reader.util.loadElem("#overlayProgress > #progressMarker");
		if (marker) {
			marker.applyStyles({ "width": `${currentPct}%` });
		}
		this.setupGoodreadsEndCard();
		reader.util.loadElem("#readerLoading").hide();
		this.loading = false;
	}

	computeChapterAnchorOffsets() {
		const offsets = [];
		const anchors = this.getAnchorElements();
		for (let i = 0; i < anchors.length; i++) {
			const block = anchors[i].closest && anchors[i].closest(".chapter-block");
			const ch = block ? parseInt(block.getAttribute("data-chapter-index"), 10) : 0;
			if (!Number.isNaN(ch) && offsets[ch] === undefined) {
				offsets[ch] = i;
			}
		}
		for (let c = 0; c <= this.book.contents.length; c++) {
			if (offsets[c] === undefined) offsets[c] = anchors.length;
		}
		return offsets;
	}

	clearChapterPagePads() {
		if (!this.pageContent) return;
		this.pageContent.querySelectorAll(".chapter-page-pad").forEach(elem => elem.remove());
	}

	async applyChapterPageAlignment() {
		if (!this.pageContent || !Array.isArray(this.book?.contents)) return;
		this.clearChapterPagePads();
		const chapterBlocks = [...this.pageContent.querySelectorAll(".chapter-block[data-chapter-index]")];
		if (chapterBlocks.length < 2) return;
		const colCount = this.getColumnCount();
		if (colCount <= 1) return;

		this.applyPageOffset();
		await new Promise(resolve => requestAnimationFrame(resolve));

		const baseOffsets = this.computeChapterAnchorOffsets();

		for (let i = 1; i < chapterBlocks.length; i++) {
			const block = chapterBlocks[i];
			const chapterIndex = parseInt(block.getAttribute("data-chapter-index"), 10);
			if (Number.isNaN(chapterIndex)) continue;
			const chapterAnchor = baseOffsets[chapterIndex] ?? 0;
			const chapterPage = await this.getPageFromAnchor(chapterAnchor);
			const remainder = Math.max(0, chapterPage) % colCount;
			const padColumns = remainder === 0 ? 0 : colCount - remainder;
			for (let p = 0; p < padColumns; p++) {
				const pad = document.createElement("div");
				pad.className = "chapter-page-pad";
				pad.setAttribute("aria-hidden", "true");
				pad.setAttribute("role", "presentation");
				block.parentNode.insertBefore(pad, block);
			}
		}
	}

	getGlobalAnchorIndex(chapter, inChapterAnchor) {
		if (!this.chapterAnchorOffsets) return Math.max(0, inChapterAnchor);
		const base = this.chapterAnchorOffsets[chapter] ?? 0;
		const nextBase = this.chapterAnchorOffsets[chapter + 1] ?? (this.getAnchorElements().length || base + 1);
		const maxInChapter = Math.max(0, nextBase - base - 1);
		return base + Math.min(inChapterAnchor, maxInChapter);
	}

	getChapterStartGlobalAnchor(chapter = null) {
		const targetChapter = chapter == null ? (this.getCurrentChapterAndAnchor().chapter || 0) : chapter;
		if (!this.chapterAnchorOffsets || !Number.isFinite(Number(targetChapter))) {
			return Math.max(0, this.position?.anchor || 0);
		}
		return Math.max(0, this.chapterAnchorOffsets[Math.max(0, Number(targetChapter))] ?? 0);
	}

	normalizeProgressValue(value) {
		const num = Number(value);
		if (!Number.isFinite(num)) return 0;
		return Math.round(Math.max(0, Math.min(100, num)) * 100) / 100;
	}

	async getPagePercentage() {
		const maxPage = Math.max(0, await this.getMaxPage());
		if (maxPage <= 0) return 0;
		return this.normalizeProgressValue((this.page / maxPage) * 100);
	}

	getPageFromPercentage(pagePercentage, maxPage) {
		const pct = this.normalizeProgressValue(pagePercentage);
		if (!Number.isFinite(maxPage) || maxPage <= 0) return 0;
		const rawPage = Math.round((pct / 100) * maxPage);
		const colCount = Math.max(1, this.getColumnCount());
		const spreadBase = Math.floor(rawPage / colCount) * colCount;
		return Math.max(0, Math.min(maxPage, spreadBase));
	}

	async savePositionState(chapter, anchor, contentPercentage = null, forceImmediate = false) {
		if (!this.book) return;
		const ch = Math.max(0, Number(chapter) || 0);
		const ach = Math.max(0, Number(anchor) || 0);
		const pct = this.normalizeProgressValue(
			contentPercentage == null ? reader.util.getReadPercentage(this.book.contents, ch, ach) : contentPercentage
		);
		this.updateOverlayProgressInfo(ch, ach, pct);
		const marker = reader.util.loadElem("#overlayProgress > #progressMarker");
		if (marker) {
			marker.applyStyles({ "width": `${pct}%` });
		}

		this.pendingPositionState = {
			chapter: ch,
			anchor: ach,
			percentage: pct,
			page: this.page,
			globalAnchor: this.position.anchor,
			chapterGlobalAnchor: this.getChapterStartGlobalAnchor(ch)
		};

		window.clearTimeout(this.positionPersistTimeout);
		if (forceImmediate) {
			const snapshot = this.pendingPositionState;
			this.pendingPositionState = null;
			this.positionPersistTimeout = null;
			if (!snapshot || !this.book) return;
			const pagePct = await this.getPagePercentage();
			await reader.store.setPosition(
				this.book,
				snapshot.chapter,
				snapshot.anchor,
				snapshot.percentage,
				snapshot.page,
				snapshot.globalAnchor,
				snapshot.chapterGlobalAnchor,
				pagePct
			);
			return;
		}

		const persistDelay = (Date.now() < (this.immersiveActiveUntil || 0) || this.spreadDetached) ? 180 : 0;
		this.positionPersistTimeout = window.setTimeout(async () => {
			const snapshot = this.pendingPositionState;
			this.pendingPositionState = null;
			this.positionPersistTimeout = null;
			if (!snapshot || !this.book) return;
			const pagePct = await this.getPagePercentage();
			await reader.store.setPosition(
				this.book,
				snapshot.chapter,
				snapshot.anchor,
				snapshot.percentage,
				snapshot.page,
				snapshot.globalAnchor,
				snapshot.chapterGlobalAnchor,
				pagePct
			);
		}, persistDelay);
	}

	async goToChapter(chapter, inChapterAnchor = 0) {
		if (this.loading || !this.pageContent) return;
		this.position.chapter = Math.max(0, Math.min(chapter, this.book.contents.length - 1));
		const globalAnchor = this.getGlobalAnchorIndex(this.position.chapter, inChapterAnchor);
		this.position.anchor = globalAnchor;
		this.page = await this.getPageFromAnchor(globalAnchor);
		this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		this.savePositionState(ch, ach, percentage);
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		await this.onResize(true);
	}

	loadAllChapterStyles() {
		const allStylesheets = new Set();
		this.book.contents.forEach(ch => {
			(ch && ch.stylesheets || []).forEach(s => allStylesheets.add(s));
		});
		const stylesheetList = Array.isArray(this.book?.stylesheets) ? this.book.stylesheets : [];
		const blockedProps = new Set([
			"display", "visibility", "opacity", "position", "left", "right", "top", "bottom",
			"transform", "color", "-webkit-text-fill-color", "font-size", "text-indent"
		]);
		const css = [...allStylesheets]
			.map(s => stylesheetList.find(ss => ss.path === s)?.data)
			.filter(Boolean)
			.map(s => {
				let str = "";
				for (const i of s) {
					if (!i.styles?.length) continue;
					const safeStyles = i.styles.filter(st => !blockedProps.has((st.name || "").toLowerCase()));
					if (!safeStyles.length) continue;
					const elems = i.appliesTo.map(e => `#reader ${e}`).join(", ");
					const values = safeStyles.map(st => `${st.name}: ${st.value};`).join(" ");
					str += `\n${elems} {\n${values}\n}`;
				}
				return str;
			})
			.join("\n");
		const existing = reader.util.loadElem("#readerStyles") || reader.util.createElement("style", document.head, "").setAttributes({ id: "readerStyles" });
		existing.innerHTML = css;
	}

	async loadChapter(anchor) {
		await this.loadFullBook(this.position.chapter, anchor);
	}

	createChapterMarkers(markers) {
		const container = reader.util.loadElem("#overlayProgress");
		if (!container || !Array.isArray(markers) || !markers.length) {
			return;
		}
		markers.forEach(m => {
			reader.util.createElement("div", container)
				.setAttributes({ "class": "chapterMarker" })
				.applyStyles({ "left": `${m.point}%` });
		});
	}

	/** NÃƒÂºmero mÃƒÂ¡ximo de Ã¢â‚¬Å“espalhesÃ¢â‚¬Â para que o container seja largo e o conteÃƒÂºdo flua em vÃƒÂ¡rias colunas (permite vÃƒÂ¡rias pÃƒÂ¡ginas). */
	static MAX_SPREADS = 200;

	/** Largura ÃƒÂºtil do spread (ÃƒÂ¡rea de conteÃƒÂºdo, sem padding lateral) para colunas iguais e paginaÃƒÂ§ÃƒÂ£o consistente. */
	getSpreadContentWidth() {
		if (!this.spreadElem) return 0;
		const w = this.spreadElem.clientWidth || 0;
		const margin = this.readerMarginPx || 0;
		return Math.max(0, w - 2 * margin);
	}

	getPageFromViewport(rootElem = null, viewportElem = null) {
		const contentRoot = rootElem || this.pageContent;
		const viewport = viewportElem || this.spreadElem;
		if (!contentRoot || !viewport || !this.spreadElem) return null;
		const contentWidth = this.getSpreadContentWidth();
		if (contentWidth <= 0) return null;
		const gap = this.getColumnGap();
		const step = contentWidth + gap;
		if (step <= 0) return null;
		const colCount = this.getColumnCount();
		const contentRect = contentRoot.getBoundingClientRect();
		const viewportRect = viewport.getBoundingClientRect();
		// Use viewport left edge projected into content flow to infer spread index deterministically.
		const xInFlow = Math.abs(contentRect.left - viewportRect.left);
		const spreadIndex = Math.max(0, Math.floor(xInFlow / step));
		return spreadIndex * colCount;
	}

	stabilizeTargetPageAfterObserver(targetPage) {
		const recentObserverMs = 900;
		if (Date.now() - (Number(this.lastPageObserverUpdateAt) || 0) > recentObserverMs) {
			return targetPage;
		}
		// When observer just set the page, ignore stale backward writes from legacy sync paths.
		if (targetPage < this.page) {
			return this.page;
		}
		return targetPage;
	}

	markSelectionDrivenSync(immersiveSelection = false) {
		const now = Date.now();
		const lockMs = immersiveSelection ? 96 : 120;
		this.lastSelectionDrivenSyncAt = now;
		this.viewportSyncLockUntil = Math.max(Number(this.viewportSyncLockUntil) || 0, now + lockMs);
		if (immersiveSelection) {
			this.immersiveAutoAdvanceLockUntil = Math.max(Number(this.immersiveAutoAdvanceLockUntil) || 0, now + Math.min(lockMs, 72));
		}
	}

	hasRecentSelectionDrivenSync(now = Date.now()) {
		const lastTs = Number(this.lastSelectionDrivenSyncAt) || 0;
		return !!lastTs && now - lastTs < 140;
	}

	/** Aplica column-width e left em pageContent (fluxo normal) para o multi-coluna usar a largura total e preencher todas as colunas. Colunas com o mesmo tamanho. */
	applyPageOffset() {
		if (!this.pageContent || !this.pageContainer || !this.spreadElem) return;
		const colCount = this.getColumnCount();
		const gap = this.getColumnGap();
		const contentWidth = this.getSpreadContentWidth();
		if (contentWidth <= 0) {
			// In detached immersive mode the working spread can be out of layout flow.
			// Keep page markers/numbers synced even if we cannot reflow columns here.
			this.updatePageNumbers();
			return;
		}
		const step = contentWidth + gap;
		const columnWidth = Math.max(1, (contentWidth - gap * (colCount - 1)) / colCount);
		const offsetPx = (this.page / colCount) * step;
		const contentHeight = this.getEffectiveViewHeight();
		const pagePadding = this.readerMarginPx || Renderer.PAGE_VERTICAL_PADDING;
		const earlyPageSingleColumn = (this.pageViewMode === "three" || this.pageViewMode === "four") && this.page < 2;
		if (earlyPageSingleColumn) {
			this.pageContainer.applyStyles({
				"width": `${columnWidth}px`,
				"minWidth": `${columnWidth}px`,
				"maxWidth": `${columnWidth}px`,
				"overflow": "hidden"
			});
		} else {
			this.pageContainer.applyStyles({
				"width": "100%",
				"minWidth": "100%",
				"maxWidth": "100%",
				"overflow": "hidden"
			});
		}
		this.pageContent.applyStyles({
			"position": "relative",
			"left": `-${offsetPx}px`,
			"transform": "none",
			"width": `${contentWidth}px`,
			"minWidth": `${contentWidth}px`,
			"height": `${contentHeight}px`,
			"maxHeight": `${contentHeight}px`,
			"columnCount": "auto",
			"columnWidth": `${columnWidth}px`,
			"columnGap": `${gap}px`,
			"columnFill": "auto",
			"transition": "none",
			"paddingTop": `${pagePadding}px`,
			"paddingBottom": `${pagePadding}px`,
			"boxSizing": "border-box"
		});
		this.updatePageNumbers();
	}

	getAnchor() {
		if (!this.pageContent || !this.spreadElem) return this.position.anchor ?? 0;
		const children = this.getAnchorElements();
		if (!children.length) return 0;
		const spreadRect = this.spreadElem.getBoundingClientRect();
		const vertOverlap = (r) => r.bottom >= spreadRect.top - 10 && r.top <= spreadRect.bottom + 10;
		const horzOverlap = (r) => r.right >= spreadRect.left - 10 && r.left <= spreadRect.right + 10;
		let bestIdx = 0;
		let bestTop = Infinity;
		let bestLeft = Infinity;
		let foundOverlap = false;
		for (let i = 0; i < children.length; i++) {
			const rect = children[i].getBoundingClientRect();
			if (vertOverlap(rect) && horzOverlap(rect)) {
				foundOverlap = true;
				if (rect.top < bestTop || (rect.top === bestTop && rect.left < bestLeft)) {
					bestTop = rect.top;
					bestLeft = rect.left;
					bestIdx = i;
				}
			}
		}
		if (!foundOverlap) {
			let minDist = Infinity;
			const viewportTop = spreadRect.top + spreadRect.height / 4;
			const viewportLeft = spreadRect.left + 20;
			for (let i = 0; i < children.length; i++) {
				const rect = children[i].getBoundingClientRect();
				const dist = Math.abs(rect.top - viewportTop) + Math.abs(rect.left - viewportLeft) * 0.001;
				if (dist < minDist) {
					minDist = dist;
					bestIdx = i;
				}
			}
		}
		return bestIdx;
	}

	async getPageFromAnchor(anchor) {
		anchor = anchor ?? 0;
		if (!this.pageContent || !this.spreadElem) return 0;
		const elems = this.getAnchorElements();
		if (!elems.length || anchor >= elems.length) return 0;
		const colCount = this.getColumnCount();
		const gap = this.getColumnGap();
		const step = this.getSpreadContentWidth() + gap;
		if (step <= 0) return 0;
		const childLeft = Math.max(0, Number(elems[anchor].offsetLeft) || 0);
		return Math.floor(childLeft / step) * colCount;
	}

	async getMaxPage() {
		if (!this.pageContent || !this.spreadElem) return 0;
		const colCount = this.getColumnCount();
		const gap = this.getColumnGap();
		const contentWidth = this.getSpreadContentWidth();
		const step = contentWidth + gap;
		if (step <= 0) return 0;
		const scrollWidth = this.getPageContainerScrollWidth();
		const maxScroll = Math.max(0, scrollWidth - contentWidth);
		if (maxScroll <= 0) return 0;
		const spreads = Math.ceil(maxScroll / step);
		return Math.max(0, Math.min(999, spreads * colCount));
	}

	insertPageSentinels(rootElem = null) {
		const root = rootElem || this.pageContent;
		if (!root || !this.spreadElem) return;
		root.querySelectorAll(".page-sentinel").forEach(elem => elem.remove());
		const contentWidth = this.getSpreadContentWidth();
		const gap = this.getColumnGap();
		const step = contentWidth + gap;
		if (step <= 0) return;
		const scrollWidth = Math.max(contentWidth, root.scrollWidth || 0);
		const spreads = Math.max(1, Math.ceil(Math.max(0, scrollWidth - contentWidth) / step) + 1);
		const colCount = this.getColumnCount();
		let spreadStride = 1;
		if (spreads > 1500) {
			spreadStride = 2;
		}
		let lastSpread = -1;
		for (let spread = 0; spread < spreads; spread += spreadStride) {
			const sentinel = document.createElement("span");
			sentinel.className = "page-sentinel";
			sentinel.setAttribute("aria-hidden", "true");
			sentinel.setAttribute("data-immersive-reader-ignore", "true");
			sentinel.dataset.page = String(spread * colCount);
			sentinel.style.position = "absolute";
			sentinel.style.left = `${spread * step}px`;
			sentinel.style.top = "0";
			sentinel.style.width = "1px";
			sentinel.style.height = "1px";
			sentinel.style.pointerEvents = "none";
			root.appendChild(sentinel);
			lastSpread = spread;
		}
		if (lastSpread !== spreads - 1) {
			const sentinel = document.createElement("span");
			sentinel.className = "page-sentinel";
			sentinel.setAttribute("aria-hidden", "true");
			sentinel.setAttribute("data-immersive-reader-ignore", "true");
			sentinel.dataset.page = String((spreads - 1) * colCount);
			sentinel.style.position = "absolute";
			sentinel.style.left = `${(spreads - 1) * step}px`;
			sentinel.style.top = "0";
			sentinel.style.width = "1px";
			sentinel.style.height = "1px";
			sentinel.style.pointerEvents = "none";
			root.appendChild(sentinel);
		}
	}

	setupPageObserver() {
		if (this.pageObserver) {
			this.pageObserver.disconnect();
			this.pageObserver = null;
		}
		this.pageSentinelVisibility = new Map();
	}

	getAnchorElements() {
		if (!this.pageContent) return [];
		const selector = ".chapter-start-anchor, p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div, figure, img, image, svg";
		return [...this.pageContent.querySelectorAll(selector)].filter(elem => {
			if (elem.classList && (elem.classList.contains("reader-chapter") || elem.classList.contains("chapter-block"))) return false;
			if (elem.classList && elem.classList.contains("chapter-start-anchor")) return true;
			const text = (elem.textContent || "").trim();
			if (text.length > 0) return true;
			const isMediaElem = elem.tagName === "IMG" || elem.tagName === "IMAGE" || elem.tagName === "SVG" || elem.tagName === "FIGURE";
			const hasMediaChild = !!elem.querySelector?.("img, image, svg");
			return isMediaElem || hasMediaChild;
		});
	}

	getStableAnchorElements(rootElem = null) {
		const root = rootElem || this.pageContent;
		if (!root) return [];
		const cached = this.stableAnchorElementsCache.get(root);
		if (cached) {
			return cached;
		}
		const selector = ".chapter-start-anchor, p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, figure, img, image, svg";
		const anchors = [...root.querySelectorAll(selector)].filter(elem => {
			if (elem.classList && (elem.classList.contains("reader-chapter") || elem.classList.contains("chapter-block"))) return false;
			if (elem.classList && elem.classList.contains("chapter-start-anchor")) return true;
			const text = (elem.textContent || "").trim();
			if (text.length > 0) return true;
			const isMediaElem = elem.tagName === "IMG" || elem.tagName === "IMAGE" || elem.tagName === "SVG" || elem.tagName === "FIGURE";
			const hasMediaChild = !!elem.querySelector?.("img, image, svg");
			return isMediaElem || hasMediaChild;
		});
		this.stableAnchorElementsCache.set(root, anchors);
		return anchors;
	}

	invalidateAnchorCaches() {
		this.anchorTextIndexCache = new WeakMap();
		this.stableAnchorElementsCache = new WeakMap();
	}

	getTextIndexForScope(scope) {
		if (!scope) return null;
		const cached = this.anchorTextIndexCache.get(scope);
		const currentLength = (scope.textContent || "").length;
		if (cached && cached.textLength === currentLength) {
			return cached;
		}
		const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
		const textNodes = [];
		const nodeOffsets = new WeakMap();
		const words = [];
		const occurrenceMap = new Map();
		let text = "";
		let absoluteStart = 0;
		let current = walker.nextNode();
		while (current) {
			const value = current.nodeValue || "";
			const start = absoluteStart;
			const end = start + value.length;
			textNodes.push({ node: current, start, end });
			nodeOffsets.set(current, { start, end });
			let i = 0;
			while (i < value.length) {
				if (!this.isWordCharacter(value[i])) {
					i++;
					continue;
				}
				let j = i + 1;
				while (j < value.length && this.isWordCharacter(value[j])) j++;
				const word = value.slice(i, j);
				const normalizedWord = this.normalizeWord(word);
				if (normalizedWord) {
					const occurrence = occurrenceMap.get(normalizedWord) || 0;
					words.push({ word, normalizedWord, wordOccurrence: occurrence, start: start + i, end: start + j });
					occurrenceMap.set(normalizedWord, occurrence + 1);
				}
				i = j;
			}
			text += value;
			absoluteStart = end;
			current = walker.nextNode();
		}
		const index = { text, textLength: text.length, textNodes, nodeOffsets, words };
		this.anchorTextIndexCache.set(scope, index);
		return index;
	}

	getAbsoluteOffsetInScope(scope, node, offset) {
		const index = this.getTextIndexForScope(scope);
		if (!index || !node) return null;
		const entry = index.nodeOffsets.get(node);
		if (!entry) return null;
		const safeOffset = Math.max(0, Math.min(Number(offset) || 0, (node.nodeValue || "").length));
		return entry.start + safeOffset;
	}

	getWordEntryAtOffset(index, offset) {
		if (!index || !Array.isArray(index.words) || !index.words.length) return null;
		const target = Math.max(0, Number(offset) || 0);
		for (const word of index.words) {
			if (target >= word.start && target < word.end) {
				return word;
			}
		}
		for (const word of index.words) {
			if (word.start >= target) {
				return word;
			}
		}
		return index.words[index.words.length - 1] || null;
	}

	getVisibleAnchorIndexFromRoot(rootElem, viewportRect) {
		const anchors = this.getStableAnchorElements(rootElem);
		if (!anchors.length || !viewportRect) return -1;
		let bestIndex = -1;
		let bestTop = Infinity;
		let bestLeft = Infinity;
		for (let i = 0; i < anchors.length; i++) {
			const rect = anchors[i].getBoundingClientRect();
			const overlapsVert = rect.bottom >= viewportRect.top - 8 && rect.top <= viewportRect.bottom + 8;
			const overlapsHorz = rect.right >= viewportRect.left - 8 && rect.left <= viewportRect.right + 8;
			if (!overlapsVert || !overlapsHorz) continue;
			if (rect.top < bestTop || (rect.top === bestTop && rect.left < bestLeft)) {
				bestTop = rect.top;
				bestLeft = rect.left;
				bestIndex = i;
			}
		}
		if (bestIndex >= 0) return bestIndex;
		let nearest = -1;
		let nearestDist = Infinity;
		const targetTop = viewportRect.top + 24;
		const targetLeft = viewportRect.left + 24;
		for (let i = 0; i < anchors.length; i++) {
			const rect = anchors[i].getBoundingClientRect();
			const dist = Math.abs(rect.top - targetTop) + Math.abs(rect.left - targetLeft) * 0.001;
			if (dist < nearestDist) {
				nearestDist = dist;
				nearest = i;
			}
		}
		return nearest;
	}

	getSelectionAnchorElement(selection) {
		if (!selection || !selection.rangeCount) return null;
		const range = selection.getRangeAt(0);
		const node = selection.anchorNode || selection.focusNode || range.startContainer;
		if (!node) return null;
		return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
	}

	async captureImmersiveProgressSnapshot() {
		if (!this.pageContent || !this.book) return null;
		const selection = window.getSelection && window.getSelection();
		if (!selection || !selection.rangeCount) return null;
		const anchorElem = this.getSelectionAnchorElement(selection);
		if (!anchorElem) return null;
		const linearRoot = reader.util.loadElem("#readerLinear");
		const clonePageContent = this.spreadClone?.querySelector?.("#pageContent")
			|| document.querySelector("#readerSpreadClone #pageContent");
		const inLinear = linearRoot && linearRoot.contains(anchorElem);
		const inClone = clonePageContent && clonePageContent.contains(anchorElem);
		if (!inLinear && !inClone) {
			return null;
		}
		const anchorSourceRoot = inLinear ? linearRoot : clonePageContent;
		if (!anchorSourceRoot) return null;

		const sourceStableAnchors = this.getStableAnchorElements(anchorSourceRoot);
		let sourceStableIndex = sourceStableAnchors.findIndex(elem => elem === anchorElem || elem.contains(anchorElem));
		if (sourceStableIndex < 0) {
			sourceStableIndex = sourceStableAnchors.findIndex(elem => anchorElem.contains(elem));
		}
		if (sourceStableIndex < 0) return null;

		const liveStableAnchors = this.getStableAnchorElements(this.pageContent);
		const mappedStableElem = liveStableAnchors[Math.max(0, Math.min(sourceStableIndex, liveStableAnchors.length - 1))];
		if (!mappedStableElem) return null;

		const anchors = this.getAnchorElements();
		let anchorIndex = anchors.findIndex(elem => elem === mappedStableElem || elem.contains(mappedStableElem) || mappedStableElem.contains(elem));
		if (anchorIndex < 0) return null;

		const colCount = this.getColumnCount();
		const liveWordSpreadPage = anchorSourceRoot !== this.pageContent
			? this.getSpreadPageFromLiveWordToken(selection, sourceStableIndex, anchorElem)
			: null;
		let selectionSpreadPage = Number.isFinite(liveWordSpreadPage) && liveWordSpreadPage >= 0
			? liveWordSpreadPage
			: await this.getPageFromAnchor(anchorIndex);
		const cloneWordSpreadPage = this.getSpreadPageFromCloneWordToken(selection, sourceStableIndex, anchorElem);
		if (Number.isFinite(cloneWordSpreadPage) && cloneWordSpreadPage >= 0) {
			selectionSpreadPage = Math.max(selectionSpreadPage, cloneWordSpreadPage);
		}
		const maxPage = await this.getMaxPage();
		let targetPage = Math.min(
			Math.floor(selectionSpreadPage / colCount) * colCount,
			maxPage
		);
		targetPage = this.stabilizeTargetPageAfterObserver(targetPage);
		const chapterAnchor = this.getCurrentChapterAndAnchor(anchorIndex);
		return {
			bookTitle: this.book.title || "",
			chapter: chapterAnchor.chapter,
			anchor: chapterAnchor.anchor,
			page: targetPage,
			globalAnchor: anchorIndex,
			updatedAt: Date.now()
		};
	}

	async jumpToImmersiveProgress(snapshot) {
		if (!snapshot || !this.book) return;
		const chapter = Math.max(0, Number(snapshot.chapter) || 0);
		const anchor = Math.max(0, Number(snapshot.anchor) || 0);
		await this.goToChapter(chapter, anchor);
	}

	async syncPageFromViewport() {
		if (Date.now() < (Number(this.immersiveActiveUntil) || 0)) {
			return;
		}
		if (!this.pageContent || !this.spreadElem || this.loading) {
			return;
		}
		const now = Date.now();
		if (now < (Number(this.manualNavLockUntil) || 0) || now < (Number(this.userInteractionLockUntil) || 0)) {
			return;
		}
		if (this.hasRecentSelectionDrivenSync(now)) {
			return;
		}
		if (Date.now() < (Number(this.fullscreenTransitionLockUntil) || 0)) {
			return;
		}
		const seq = ++this.pageSyncSeq;
		const physicalPage = this.getPageFromViewport(this.pageContent, this.spreadElem);
		if (!Number.isFinite(physicalPage)) {
			return;
		}
		const maxPage = await this.getMaxPage();
		const colCount = this.getColumnCount();
		let targetPage = Math.max(0, Math.min(maxPage, Math.floor(physicalPage / colCount) * colCount));
		targetPage = this.stabilizeTargetPageAfterObserver(targetPage);
		if (targetPage < this.page) {
			targetPage = this.page;
		}
		if (targetPage > this.page + colCount) {
			targetPage = Math.min(maxPage, this.page + colCount);
		}
		if (targetPage === this.page) {
			return;
		}
		if (seq !== this.pageSyncSeq) {
			return;
		}
		this.page = targetPage;
		this.applyPageOffset();
		this.updatePageNumbers();
		this.position.anchor = this.getAnchor();
		this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		const current = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, current.chapter, current.anchor);
		this.savePositionState(current.chapter, current.anchor, percentage);
		this.selectionSyncLockUntil = Date.now() + 24;
		this.viewportSyncLockUntil = Math.max(Number(this.viewportSyncLockUntil) || 0, Date.now() + 80);
	}

	async syncPageFromImmersiveCloneViewport() {
		if (Date.now() < (Number(this.immersiveActiveUntil) || 0)) {
			return;
		}
		if (!this.spreadDetached || !this.spreadClone || !this.pageContent || !this.spreadElem || this.loading) {
			return;
		}
		const now = Date.now();
		if (now < (Number(this.manualNavLockUntil) || 0) || now < (Number(this.userInteractionLockUntil) || 0)) {
			return;
		}
		if (this.hasRecentSelectionDrivenSync(now)) {
			return;
		}
		if (Date.now() < (Number(this.fullscreenTransitionLockUntil) || 0)) {
			return;
		}
		const seq = ++this.pageSyncSeq;
		if (now < (Number(this.immersiveAutoAdvanceLockUntil) || 0)) {
			return;
		}
		if (this.immersiveViewportSyncBusy) {
			return;
		}
		this.immersiveViewportSyncBusy = true;
		try {
			const clonePageContent = this.spreadClone.querySelector?.("#pageContent")
				|| document.querySelector("#readerSpreadClone #pageContent");
			if (!clonePageContent) {
				return;
			}
			const viewportElem = reader.util.loadElem("#reader") || this.container || this.spreadClone;
			if (!viewportElem) {
				return;
			}
			const physicalPage = this.getPageFromViewport(clonePageContent, viewportElem);
			if (Number.isFinite(physicalPage)) {
				const maxPage = await this.getMaxPage();
				const colCount = this.getColumnCount();
				let targetPage = Math.max(0, Math.min(maxPage, Math.floor(physicalPage / colCount) * colCount));
				targetPage = this.stabilizeTargetPageAfterObserver(targetPage);
				// In detached immersive flow, allow only one spread advance per sync tick.
				if (targetPage < this.page) {
					targetPage = this.page;
				}
				if (targetPage > this.page + colCount) {
					targetPage = Math.min(maxPage, this.page + colCount);
				}
				if (targetPage !== this.page) {
					if (seq !== this.pageSyncSeq) {
						return;
					}
					this.page = targetPage;
		this.applyPageOffset();
					this.updatePageNumbers();
					this.lastImmersiveAdvancePage = this.page;
					this.lastImmersiveAdvanceAt = Date.now();
					this.position.anchor = this.getAnchor();
					this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
					this.lastTrackedAnchor = this.position.anchor;
					this.lastTrackedChapter = this.position.chapter;
					const current = this.getCurrentChapterAndAnchor();
					const percentage = reader.util.getReadPercentage(this.book.contents, current.chapter, current.anchor);
					this.savePositionState(current.chapter, current.anchor, percentage);
					this.selectionSyncLockUntil = Date.now() + 24;
					this.immersiveAutoAdvanceLockUntil = Date.now() + 60;
					return;
				}
			}
			const viewportRect = viewportElem.getBoundingClientRect();
			const sourceStableIndex = this.getVisibleAnchorIndexFromRoot(clonePageContent, viewportRect);
			if (sourceStableIndex < 0) {
				return;
			}
			const previousStableIndex = Number(this.lastImmersiveCloneStableIndex);
			if (Number.isFinite(previousStableIndex) && sourceStableIndex <= previousStableIndex) {
				// Reset baseline when Immersive reflows and anchor indices shift backwards.
				if (previousStableIndex - sourceStableIndex > 40) {
					this.lastImmersiveCloneStableIndex = sourceStableIndex;
				}
				return;
			}
			const liveStableAnchors = this.getStableAnchorElements(this.pageContent);
			const mappedStableElem = liveStableAnchors[Math.max(0, Math.min(sourceStableIndex, liveStableAnchors.length - 1))];
			if (!mappedStableElem) {
				return;
			}
			const anchors = this.getAnchorElements();
			let anchorIndex = anchors.findIndex(elem => elem === mappedStableElem || elem.contains(mappedStableElem) || mappedStableElem.contains(elem));
			if (anchorIndex < 0) {
				return;
			}
			const colCount = this.getColumnCount();
			const selectionSpreadPage = await this.getPageFromAnchor(anchorIndex);
			if (selectionSpreadPage <= this.page) {
				return;
			}
			const maxPage = await this.getMaxPage();
			let targetPage = Math.min(
				Math.floor(selectionSpreadPage / colCount) * colCount,
				maxPage
			);
			targetPage = this.stabilizeTargetPageAfterObserver(targetPage);
			const maxForwardJump = Math.max(colCount * 2, this.getNavigationStep("next") * 4);
			if (targetPage > this.page + maxForwardJump) {
				// Step forward instead of freezing when TTS jumps ahead quickly.
				targetPage = Math.min(maxPage, this.page + colCount);
			}
			if (targetPage <= this.page) {
				this.lastImmersiveCloneStableIndex = sourceStableIndex;
				return;
			}
			const nowTs = Date.now();
			if (targetPage === this.lastImmersiveAdvancePage && nowTs - this.lastImmersiveAdvanceAt < 140) {
				return;
			}
			if (seq !== this.pageSyncSeq) {
				return;
			}
			this.page = Math.max(0, Math.min(maxPage, targetPage));
		this.applyPageOffset();
			this.updatePageNumbers();
			this.lastImmersiveCloneStableIndex = sourceStableIndex;
			this.lastImmersiveAdvancePage = this.page;
			this.lastImmersiveAdvanceAt = nowTs;
			this.position.anchor = this.getAnchor();
			this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
			this.lastTrackedAnchor = this.position.anchor;
			this.lastTrackedChapter = this.position.chapter;
			const current = this.getCurrentChapterAndAnchor();
			const percentage = reader.util.getReadPercentage(this.book.contents, current.chapter, current.anchor);
			this.savePositionState(current.chapter, current.anchor, percentage);
			this.selectionSyncLockUntil = Date.now() + 16;
			// Avoid rapid spread jumps caused by bursty Immersive Reader DOM mutations.
			this.immersiveAutoAdvanceLockUntil = Date.now() + 40;
		} finally {
			this.immersiveViewportSyncBusy = false;
		}
	}

	/** Chapter index and in-chapter anchor for percentage and store. @param globalIndex optional. */
	getCurrentChapterAndAnchor(globalIndex) {
		const anchors = this.getAnchorElements();
		const idx = typeof globalIndex === "number" ? globalIndex : this.position.anchor;
		if (idx < 0 || !anchors[idx]) {
			return { chapter: this.position.chapter, anchor: Math.max(0, idx) };
		}
		const el = anchors[idx];
		let block = el.closest && (el.closest(".chapter-block") || el.closest(".reader-chapter"));
		if (!block) {
			for (let i = idx - 1; i >= 0; i--) {
				block = anchors[i].closest && (anchors[i].closest(".chapter-block") || anchors[i].closest(".reader-chapter"));
				if (block) {
					const ch = parseInt(block.getAttribute("data-chapter-index"), 10);
					if (!Number.isNaN(ch)) {
						const base = this.chapterAnchorOffsets?.[ch] ?? 0;
						return { chapter: ch, anchor: Math.max(0, idx - base) };
					}
				}
			}
			return { chapter: 0, anchor: Math.min(idx, (this.chapterAnchorOffsets?.[1] ?? anchors.length) - 1) };
		}
		const chapter = parseInt(block.getAttribute("data-chapter-index"), 10);
		if (Number.isNaN(chapter)) return { chapter: this.position.chapter, anchor: idx };
		const inChapterAnchors = anchors.filter((e, i) => i <= idx && (e.closest(".chapter-block") || e.closest(".reader-chapter")) === block);
		const anchor = inChapterAnchors.length - 1;
		return { chapter, anchor: Math.max(0, anchor) };
	}

	loadChapterStyles() {
		const chapter = this.book.contents[this.position.chapter];
		const stylesheets = chapter && chapter.stylesheets ? chapter.stylesheets : [];
		const blockedProps = new Set([
			"display",
			"visibility",
			"opacity",
			"position",
			"left",
			"right",
			"top",
			"bottom",
			"transform",
			"color",
			"-webkit-text-fill-color",
			"font-size",
			"text-indent"
		]);
		const css = stylesheets
			.map(s => this.book.stylesheets.find(ss => ss.path === s)?.data)
			.filter(Boolean)
			.map(s => {
				let str = "";
				for (const i of s) {
					if (!i.styles?.length) continue;
					const safeStyles = i.styles.filter(st => !blockedProps.has((st.name || "").toLowerCase()));
					if (!safeStyles.length) continue;
					const elems = i.appliesTo.map(e => `#reader ${e}`).join(", ");
					const values = safeStyles.map(st => `${st.name}: ${st.value};`).join(" ");
					str += `\n${elems} {\n${values}\n}`;
				}
				return str;
			})
			.join("\n");
		const existing = reader.util.loadElem("#readerStyles") || reader.util.createElement("style", document.head, "").setAttributes({ "id": "readerStyles" });
		existing.innerHTML = css;
	}

	/** Remove elements that cause Immersive Reader to loop or treat as document boundaries. */
	sanitizeChapterHtml(html) {
		if (!html || typeof html !== "string" || !this.hideOceanPdfWatermark) return html || "";
		const wrap = document.createElement("div");
		wrap.innerHTML = html;
		this.stripOceanPdfWatermark(wrap);
		return wrap.innerHTML;
	}

	stripOceanPdfWatermark(root) {
		if (!this.hideOceanPdfWatermark || !root?.querySelectorAll) return;
		const watermarkPattern = /oceanofpdf\.com/i;
		root.querySelectorAll("a[href], a").forEach(link => {
			const href = String(link.getAttribute("href") || "").trim();
			const text = String(link.textContent || "").trim();
			if (!watermarkPattern.test(href) && !watermarkPattern.test(text)) return;
			link.remove();
		});
		root.querySelectorAll("p, div, span, li, small, em, strong").forEach(elem => {
			const text = String(elem.textContent || "").replace(/\s+/g, " ").trim();
			if (!text || !watermarkPattern.test(text)) return;
			if (elem.querySelector("img, svg, table, ul, ol, blockquote, h1, h2, h3, h4, h5, h6")) return;
			elem.remove();
		});
	}

	sanitizeHtmlForLinearReading(html) {
		if (!html || typeof html !== "string") return "";
		const wrap = document.createElement("div");
		wrap.innerHTML = html;
		this.stripOceanPdfWatermark(wrap);
		wrap.querySelectorAll("hr").forEach(el => el.remove());
		wrap.querySelectorAll("section, article").forEach(el => {
			const div = document.createElement("div");
			div.innerHTML = el.innerHTML;
			el.replaceWith(div);
		});
		wrap.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
		wrap.querySelectorAll("[data-epub-type]").forEach(el => el.removeAttribute("data-epub-type"));
		wrap.querySelectorAll("*").forEach(el => {
			el.getAttributeNames().forEach(name => {
				if (/epub:type/i.test(name)) el.removeAttribute(name);
			});
			const role = (el.getAttribute("role") || "").toLowerCase();
			if (/doc-(chapter|part|section|division)/.test(role)) el.removeAttribute("role");
		});
		return wrap.innerHTML;
	}

	ensureReadableChapterText(root) {
		const container = root || this.pageContent;
		if (!container) {
			return;
		}
		if (container === this.pageContent) {
			this.normalizePagedImages(container);
		}
		const elems = [container, ...container.querySelectorAll("*")];
		elems.forEach(elem => {
			const hasText = !!(elem.textContent || "").trim();
			const hasTextChild = !!elem.querySelector?.("p, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, a");
			if (!hasText && !hasTextChild) {
				return;
			}
			const style = window.getComputedStyle(elem);
			if (style.display === "none") {
				const inlineTags = ["SPAN", "A", "EM", "STRONG", "B", "I", "SMALL", "SUP", "SUB", "CODE"];
				const display = inlineTags.includes(elem.tagName) ? "inline" : "block";
				elem.style.setProperty("display", display, "important");
			}
			if (style.visibility === "hidden") {
				elem.style.setProperty("visibility", "visible", "important");
			}
			if ((parseFloat(style.opacity) || 0) === 0) {
				elem.style.setProperty("opacity", "1", "important");
			}
			const size = parseFloat(style.fontSize) || 0;
			if (size <= 1) {
				elem.style.setProperty("font-size", "inherit", "important");
			}
			if (style.textIndent && parseFloat(style.textIndent) > 400) {
				elem.style.setProperty("text-indent", "0", "important");
			}
			// Some EPUBs place front-matter blocks with absolute/fixed positioning, which
			// can stack title/copyright pages on top of each other in our paged flow.
			if (style.position === "absolute" || style.position === "fixed") {
				elem.style.setProperty("position", "static", "important");
				elem.style.setProperty("left", "auto", "important");
				elem.style.setProperty("right", "auto", "important");
				elem.style.setProperty("top", "auto", "important");
				elem.style.setProperty("bottom", "auto", "important");
				elem.style.setProperty("transform", "none", "important");
			}
			const transparentColor = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0(?:\.0+)?\s*\)$/.test(style.color || "");
			const transparentFill = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0(?:\.0+)?\s*\)$/.test(style.webkitTextFillColor || "");
			if (transparentColor || transparentFill) {
				elem.style.setProperty("color", "var(--text1, #111)", "important");
				elem.style.setProperty("-webkit-text-fill-color", "currentColor", "important");
			}
		});
	}

	normalizePagedImages(container) {
		if (!container) return;
		const images = [...container.querySelectorAll("img, image, svg")];
		images.forEach(img => {
			if (!img || !img.parentElement) return;
			if (img.closest("#goodreadsEndCard, #readerNavLeft, #readerNavRight")) return;

			const parent = img.parentElement;
			if (parent.tagName === "FIGURE") {
				parent.classList.add("reader-image-block");
				return;
			}
			if (parent.classList.contains("reader-image-block")) {
				return;
			}

			const wrapper = document.createElement("div");
			wrapper.className = "reader-image-block";
			parent.insertBefore(wrapper, img);
			wrapper.appendChild(img);
		});
	}

	ensureNavEdges() {
		if (reader.util.loadElem("#readerNavLeft") && reader.util.loadElem("#readerNavRight")) {
			return;
		}

		const host = document.body;

		const createEdge = (id, img, label) => {
			const elem = reader.util.createElement("div", host, "readerNavEdge").setAttributes({
				"id": id,
				"role": "button",
				"aria-label": label,
				"title": label
			});
			const image = reader.util.createElement("img", elem);
			image.src = `assets/${img}`;
			image.setAttribute("draggable", "false");
			return elem;
		};

		if (!reader.util.loadElem("#readerNavLeft")) {
			createEdge("readerNavLeft", "previous.png", "PÃƒÂ¡gina anterior");
		}

		if (!reader.util.loadElem("#readerNavRight")) {
			createEdge("readerNavRight", "next.png", "PrÃƒÂ³xima pÃƒÂ¡gina");
		}
	}

	setNavSettings(settings = {}) {
		if (typeof settings.showNavArrows === "boolean") {
			this.showNavArrows = settings.showNavArrows;
			if (!this.showNavArrows) {
				this.hideNavEdge("left");
				this.hideNavEdge("right");
			}
		}
		if (typeof settings.tapToNavigate === "boolean") {
			this.tapToNavigate = settings.tapToNavigate;
		}
		if (typeof settings.pageViewMode === "string") {
			this.pageViewMode = settings.pageViewMode;
		}
		if (settings.readerMargin != null) {
			this.readerMarginPx = Math.max(20, Math.min(100, Number(settings.readerMargin) || 50));
		}
		if (typeof settings.themeMode === "string") {
			this.themeMode = settings.themeMode;
		}
		if (typeof settings.textColor === "string" && settings.textColor) {
			this.textColor = settings.textColor;
		}
		if (typeof settings.backgroundColor === "string" && settings.backgroundColor) {
			this.backgroundColor = settings.backgroundColor;
		}
		if (typeof settings.synopsisSidebarWidth === "string" && settings.synopsisSidebarWidth) {
			this.synopsisSidebarWidth = settings.synopsisSidebarWidth;
			if (this.synopsisSidebarVisible) {
				this.updateSynopsisSidebarLayout();
			}
		}
	}

	onReaderTap(event) {
		// Disable click-to-navigate to avoid page changes on user clicks.
		return;
		if (!event || event.button !== 0) {
			return;
		}
		if (event.defaultPrevented) {
			return;
		}
		const selection = window.getSelection && window.getSelection();
		if (selection && selection.type === "Range") {
			return;
		}
		const target = event.target;
		if (!target || !target.closest) {
			return;
		}
		if (target.closest("#readerOverlayTop, #readerOverlayBottom, #readerOverlaySmall, #readerNavLeft, #readerNavRight, #infoBoxContainer, button, a, input, textarea")) {
			return;
		}
		const x = event.clientX;
		if (!x || !window.innerWidth) {
			return;
		}
		if (x < window.innerWidth / 2) {
			this.prevPage();
			return;
		}
		this.nextPage();
	}

	normalizeEpubPath(value) {
		if (!value) return "";
		let path = String(value);
		try {
			path = decodeURIComponent(path);
		} catch (_err) {}
		path = path.replace(/\\/g, "/").replace(/^\/+/, "");
		while (path.startsWith("./")) {
			path = path.slice(2);
		}
		return path;
	}

	findChapterIndexByFilename(filename) {
		if (!this.book || !Array.isArray(this.book.contents)) return -1;
		const target = this.normalizeEpubPath(filename);
		if (!target) return -1;
		for (let i = 0; i < this.book.contents.length; i++) {
			const entry = this.book.contents[i];
			if (!entry || !entry.filename) continue;
			if (this.normalizeEpubPath(entry.filename) === target) return i;
		}
		return -1;
	}

	findChapterIndexByFilenameFlexible(filename) {
		const direct = this.findChapterIndexByFilename(filename);
		if (direct >= 0) return direct;
		if (!this.book || !Array.isArray(this.book.contents)) return -1;
		const target = this.normalizeEpubPath(filename);
		if (!target) return -1;
		const targetSuffix = target.replace(/^\/+/, "");
		for (let i = 0; i < this.book.contents.length; i++) {
			const entry = this.book.contents[i];
			if (!entry || !entry.filename) continue;
			const entryPath = this.normalizeEpubPath(entry.filename);
			if (entryPath === targetSuffix || entryPath.endsWith("/" + targetSuffix)) {
				return i;
			}
		}
		return -1;
	}

	escapeCssIdentifier(value) {
		if (!value) return "";
		if (window.CSS && typeof window.CSS.escape === "function") {
			return window.CSS.escape(value);
		}
		return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
	}

	findAnchorElementById(rootElem, anchor) {
		if (!rootElem || !anchor) return null;
		const trimmed = String(anchor || "").trim();
		if (!trimmed) return null;
		const escaped = this.escapeCssIdentifier(trimmed);
		let found = null;
		try {
			if (escaped) {
				found = rootElem.querySelector(`#${escaped}`);
			}
		} catch (_err) {}
		if (found) return found;
		const named = rootElem.querySelectorAll("[name]");
		for (const elem of named) {
			if (elem.getAttribute("name") === trimmed) {
				return elem;
			}
		}
		return null;
	}

	getAnchorIndexFromElement(elem) {
		if (!elem || !this.pageContent) return -1;
		const anchors = this.getAnchorElements();
		if (!anchors.length) return -1;
		let idx = anchors.findIndex(anchor => anchor === elem || anchor.contains(elem) || elem.contains(anchor));
		if (idx >= 0) return idx;
		const selector = ".chapter-start-anchor, p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div, figure, img, image, svg";
		const anchorElem = elem.closest ? elem.closest(selector) : null;
		if (anchorElem) {
			idx = anchors.findIndex(anchor => anchor === anchorElem || anchor.contains(anchorElem) || anchorElem.contains(anchor));
			if (idx >= 0) return idx;
		}
		return anchors.findIndex(anchor => anchor.contains(elem) || elem.contains(anchor));
	}

	getChapterIndexFromElement(elem) {
		if (!elem) return -1;
		const block = elem.closest ? elem.closest(".chapter-block[data-chapter-index]") : null;
		if (!block) return -1;
		const idx = Number.parseInt(block.getAttribute("data-chapter-index"), 10);
		return Number.isFinite(idx) ? idx : -1;
	}

	resolveInternalLinkTarget(hrefRaw, linkElem) {
		const href = String(hrefRaw || "").trim();
		if (!href) return null;
		if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
		if (href.startsWith("//")) return null;

		const parts = href.split("#");
		const pathPart = parts.shift() || "";
		let anchor = parts.length ? parts.join("#") : "";
		try {
			anchor = decodeURIComponent(anchor);
		} catch (_err) {}

		const sourceChapterIndex = this.getChapterIndexFromElement(linkElem);
		const baseFilename = sourceChapterIndex >= 0 ? (this.book?.contents?.[sourceChapterIndex]?.filename || "") : "";
		let targetChapterIndex = sourceChapterIndex;

		if (pathPart) {
			const resolved = this.normalizeEpubPath(reader.util.getRelativePath(baseFilename || "", pathPart));
			targetChapterIndex = this.findChapterIndexByFilenameFlexible(resolved);
			if (targetChapterIndex < 0) {
				targetChapterIndex = this.findChapterIndexByFilenameFlexible(this.normalizeEpubPath(pathPart));
			}
		}

		if (targetChapterIndex < 0 && !pathPart && sourceChapterIndex >= 0) {
			targetChapterIndex = sourceChapterIndex;
		}

		if (targetChapterIndex < 0) return null;

		return {
			chapterIndex: targetChapterIndex,
			anchor: anchor
		};
	}

	async navigateToLinkTarget(target) {
		if (!target || !this.pageContent) return;
		const chapterIndex = Math.max(0, Number(target.chapterIndex) || 0);
		const anchor = String(target.anchor || "").trim();
		if (!anchor) {
			await this.goToChapter(chapterIndex, 0);
			return;
		}
		const block = this.pageContent.querySelector(`.chapter-block[data-chapter-index="${chapterIndex}"]`);
		let anchorElem = this.findAnchorElementById(block, anchor);
		if (!anchorElem) {
			anchorElem = this.findAnchorElementById(this.pageContent, anchor);
		}
		if (!anchorElem) {
			await this.goToChapter(chapterIndex, 0);
			return;
		}
		const anchorIndex = this.getAnchorIndexFromElement(anchorElem);
		if (anchorIndex < 0) {
			await this.goToChapter(chapterIndex, 0);
			return;
		}
		const resolved = this.getCurrentChapterAndAnchor(anchorIndex);
		await this.goToChapter(resolved.chapter, resolved.anchor);
	}

	async onContentLinkClick(event) {
		if (!event || event.defaultPrevented || this.loading) return;
		if (event.button !== 0) return;
		if (!event.target || !event.target.closest) return;
		const link = event.target.closest("a[href]");
		if (!link || !this.pageContent || !this.pageContent.contains(link)) return;
		const href = link.getAttribute("href") || "";
		const target = this.resolveInternalLinkTarget(href, link);
		if (!target) return;
		event.preventDefault();
		event.stopPropagation();
		await this.navigateToLinkTarget(target);
	}

	async goToTocItem(tocItem) {
		if (!tocItem || !this.book || !Array.isArray(this.book.contents)) return;
		const rawContent = String(tocItem.content || "");
		const rawAnchor = String(tocItem.anchor || "");
		const chapterIndex = this.findChapterIndexByFilenameFlexible(rawContent);
		if (chapterIndex < 0) {
			await this.goToChapter(0, 0);
			return;
		}
		if (!rawAnchor) {
			await this.goToChapter(chapterIndex, 0);
			return;
		}
		await this.navigateToLinkTarget({
			chapterIndex,
			anchor: rawAnchor
		});
	}


	async onResize(noTransition) {
		const maxWidth = await reader.store.loadSetting("maxWidth");
		const fontSizeRaw = await reader.store.loadSetting("fontSize");
		const lineSpacingRaw = await reader.store.loadSetting("lineSpacing");
		const fontFamily = await reader.store.loadSetting("font");
		const pageViewMode = (await reader.store.loadSetting("pageViewMode")) || this.pageViewMode || "two";
		const readerMargin = Math.max(20, Math.min(100, Number(await reader.store.loadSetting("readerMargin")) || this.readerMarginPx || 50));
		const storedNavArrowStyle = (await reader.store.loadSetting("navArrowStyle")) || "classic";
		const navArrowStyle = storedNavArrowStyle === "theme" ? "interface" : storedNavArrowStyle;
		const appearance = this.resolveReaderAppearance({
			theme: await reader.store.loadSetting("theme"),
			themeMode: (await reader.store.loadSetting("themeMode")) || this.themeMode || "light",
			textColor: await reader.store.loadSetting("textColor"),
			backgroundColor: await reader.store.loadSetting("backgroundColor"),
			readerColorSource: await reader.store.loadSetting("readerColorSource"),
			readerThemePreset: await reader.store.loadSetting("readerThemePreset")
		});
		const themeMode = appearance.themeMode;
		const textColor = appearance.textColor;
		const backgroundColor = appearance.backgroundColor;
		const interfaceColor = (await reader.store.loadSetting("interfaceColor")) || "#1877f2";
		const navArrowColorRaw = await reader.store.loadSetting("navArrowColor");
		const synopsisSidebarWidth = (await reader.store.loadSetting("synopsisSidebarWidth")) || this.synopsisSidebarWidth || "one-third";
		const columnMarkerColor = await reader.store.loadSetting("columnMarkerColor");
		const fontSize = Math.min(64, Math.max(12, Number(fontSizeRaw) || 16));
		const lineSpacing = Math.min(3, Math.max(1.05, Number(lineSpacingRaw) || 1.35));
		this.pageViewMode = pageViewMode;
		this.readerMarginPx = readerMargin;
		this.themeMode = themeMode;
		this.textColor = textColor;
		this.backgroundColor = backgroundColor;
		this.synopsisSidebarWidth = synopsisSidebarWidth;
		if (this.synopsisSidebarVisible) {
			this.updateSynopsisSidebarLayout();
		}

		const root = document.documentElement;
		if (root) {
			root.style.setProperty("--reader-page-bg", backgroundColor || (themeMode === "dark" ? "#000000" : "#ffffff"));
			let navArrowFg = navArrowStyle === "classic" ? "#d4af37" : (interfaceColor || "#1877f2");
			if (navArrowStyle === "custom" && typeof navArrowColorRaw === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(navArrowColorRaw.trim())) {
				navArrowFg = navArrowColorRaw.trim();
			}
			if (!navArrowFg || navArrowFg === "transparent" || navArrowFg === "rgba(0, 0, 0, 0)") {
				navArrowFg = navArrowStyle === "classic" ? "#d4af37" : "#1877f2";
			}
			if (typeof columnMarkerColor === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(columnMarkerColor.trim())) {
				root.style.setProperty("--column-marker-color", columnMarkerColor.trim());
			} else {
				root.style.removeProperty("--column-marker-color");
			}
			root.style.setProperty("--nav-arrow-bg", "transparent");
			root.style.setProperty("--nav-arrow-fg", navArrowFg);
		}

		if (document?.body) {
			const useMaskedArrows = navArrowStyle === "interface" || navArrowStyle === "custom";
			document.body.classList.toggle("nav-arrow-masked", useMaskedArrows);
			document.body.classList.toggle("nav-arrow-themed", useMaskedArrows);
		}

		this.readerStylesheet.innerHTML = `
			#reader,
			#readerSpread,
			#pageContainer {
				background: ${backgroundColor} !important;
				color: ${textColor} !important;
			}
			#reader p {
				font-size: ${fontSize}px !important;
				line-height: ${lineSpacing}em !important;
				font-family: ${fontFamily} !important;
			}
			#reader #pageContent {
				color: ${textColor} !important;
				font-size: ${fontSize}px !important;
				line-height: ${lineSpacing}em !important;
				font-family: ${fontFamily} !important;
			}
			#reader #pageContent * {
				color: inherit !important;
				font-family: inherit !important;
				line-height: inherit !important;
				-webkit-text-fill-color: currentColor !important;
				opacity: 1 !important;
				visibility: visible !important;
				text-shadow: none !important;
				mix-blend-mode: normal !important;
				filter: none !important;
			}
			#reader #readerLinear {
				color: ${textColor} !important;
				font-size: ${fontSize}px !important;
				line-height: ${lineSpacing}em !important;
				font-family: ${fontFamily} !important;
			}
			#reader #readerLinear * {
				color: inherit !important;
				font-family: inherit !important;
				line-height: inherit !important;
			}
		`;

		const margin = 25;
		let targetWidth = maxWidth === "none" ? window.innerWidth : Math.min(window.innerWidth, maxWidth);
		let width = Math.max(0, Math.min(targetWidth, window.innerWidth - margin * 2));
		const TWO_PAGE_VIEW_MAX_WIDTH = 1600;
		if (pageViewMode === "two" && width >= 1000) {
			width = Math.min(width, TWO_PAGE_VIEW_MAX_WIDTH);
		}

		this.container.applyStyles({
			"width": `${width}px`,
			"padding": "0",
			"margin": `${margin}px`
		});

		const readerElem = reader.util.loadElem("#reader");
		if (readerElem) {
			readerElem.style.setProperty("width", `${width}px`, "important");
			readerElem.style.setProperty("max-width", `${width}px`, "important");
			readerElem.style.setProperty("overflow-x", "hidden", "important");
			readerElem.style.setProperty("overflow", "hidden", "important");
			readerElem.style.setProperty("background", backgroundColor, "important");
			readerElem.style.setProperty("color", textColor, "important");
		}
		if (this.spreadElem) {
			this.spreadElem.style.setProperty("padding-left", `${readerMargin}px`, "important");
			this.spreadElem.style.setProperty("padding-right", `${readerMargin}px`, "important");
		}

		this.flushCSS(this.container);

		if (this.pageContent) {
			this.ensureReadableChapterText();
			await this.applyChapterPageAlignment();
			this.page = Math.min(this.page, Math.max(0, await this.getMaxPage()));
		this.applyPageOffset();
		}

		this.showColumnMarkers();
		this.updateColumnMarkers();
		this.updatePageNumbers();

		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		this.updateOverlayProgressInfo(ch, ach, percentage);
		reader.util.loadElem("#overlayProgress > #progressMarker").applyStyles({
			"width": `${percentage}%`
		});

		await this.updateCompletionStatus();

		if (!noTransition && this.book) {
			this.loading = true;
			window.clearTimeout(this.positionSaveTimeout);
			this.positionSaveTimeout = window.setTimeout(() => {
				this.position.anchor = this.getAnchor();
				const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
				const pct = reader.util.getReadPercentage(this.book.contents, ch, ach);
				this.savePositionState(ch, Math.max(ach, 0), pct);
				this.loading = false;
			}, 300);
		}
	}
	getMarkerColumnCount() {
		if (this.pageViewMode === "four") return 4;
		if (this.pageViewMode === "three") return 3;
		if (this.pageViewMode === "two") return 2;
		return 1;
	}

	getVisibleColumnCountForCurrentPage() {
		const columnCount = this.getColumnCount();
		return ((this.pageViewMode === "three" || this.pageViewMode === "four") && this.page < 2) ? 1 : columnCount;
	}

	ensureColumnMarkers() {
		if (this.columnMarkers) {
			return;
		}

		this.columnMarkers = reader.util.createElement("div", document.body, "columnMarkers")
			.setAttributes({
				"id": "columnMarkers",
				"aria-hidden": "true",
				"role": "presentation",
				"data-immersive-reader-ignore": "true"
			});
		this.columnMarkers.applyStyles({ "opacity": "1" });

		const markerColumns = this.getMarkerColumnCount();
		const markerPositions = [0.32, 0.64, 0.96];
		const markerData = [];
		let code = "A".charCodeAt(0);
		for (let col = 0; col < markerColumns; col++) {
			for (const pos of markerPositions) {
				markerData.push({
					column: col,
					letter: String.fromCharCode(code++),
					pos
				});
			}
		}

		this.columnMarkerItems = markerData.map(item => {
			const elem = reader.util.createElement("div", this.columnMarkers, "columnMarkerLabel");
			elem.innerText = item.letter;
			elem.dataset.column = item.column;
			elem.dataset.pos = item.pos;
			elem.setAttributes({
				"aria-hidden": "true",
				"role": "presentation",
				"data-immersive-reader-ignore": "true"
			});
			return elem;
		});
	}

	ensurePageNumbers() {
		if (this.pageNumbers) {
			return;
		}
		this.pageNumbers = reader.util.createElement("div", document.body, "pageNumbers")
			.setAttributes({
				"id": "pageNumbers",
				"aria-hidden": "true",
				"role": "presentation",
				"data-immersive-reader-ignore": "true"
			});
		const maxCols = 4;
		this.pageNumberItems = [];
		for (let i = 0; i < maxCols; i++) {
			const elem = reader.util.createElement("div", this.pageNumbers, "pageNumberLabel");
			elem.setAttributes({
				"aria-hidden": "true",
				"role": "presentation",
				"data-immersive-reader-ignore": "true",
				"data-column": String(i)
			});
			elem.innerText = "";
			this.pageNumberItems.push(elem);
		}
	}

	buildTocAnchorMap() {
		this.tocAnchorMap = [];
		if (!this.book || !Array.isArray(this.book.tableOfContents) || !this.pageContent) {
			return;
		}
		const entries = [];
		for (const item of this.book.tableOfContents) {
			if (!item || typeof item !== "object") {
				continue;
			}
			const title = String(item.title || "").trim();
			const content = String(item.content || "").trim();
			const chapterIndex = this.findChapterIndexByFilenameFlexible(content);
			if (chapterIndex < 0) {
				continue;
			}
			let anchorIndex = -1;
			const chapterBlock = this.pageContent.querySelector(`.chapter-block[data-chapter-index="${chapterIndex}"]`);
			let anchorElem = null;
			const anchorId = String(item.anchor || "").trim();
			if (anchorId) {
				if (chapterBlock) {
					anchorElem = this.findAnchorElementById(chapterBlock, anchorId);
				}
				if (!anchorElem) {
					anchorElem = this.findAnchorElementById(this.pageContent, anchorId);
				}
			}
			if (anchorElem) {
				anchorIndex = this.getAnchorIndexFromElement(anchorElem);
			}
			if (anchorIndex < 0 && Array.isArray(this.chapterAnchorOffsets)) {
				const base = this.chapterAnchorOffsets[chapterIndex];
				if (Number.isFinite(Number(base))) {
					anchorIndex = Number(base);
				}
			}
			if (anchorIndex < 0) {
				continue;
			}
			entries.push({
				title,
				anchorIndex,
				chapterIndex
			});
		}
		entries.sort((a, b) => a.anchorIndex - b.anchorIndex);
		this.tocAnchorMap = entries;
	}

	getSectionTitleForPosition(chapter, inChapterAnchor) {
		const fallback = this.book?.contents?.[chapter]?.title || "CapÃƒÂ­tulo sem tÃƒÂ­tulo";
		if (!Array.isArray(this.tocAnchorMap) || !this.tocAnchorMap.length) {
			return fallback;
		}
		const globalAnchor = this.getGlobalAnchorIndex(chapter, inChapterAnchor);
		let best = null;
		for (const entry of this.tocAnchorMap) {
			if (entry.anchorIndex > globalAnchor) {
				break;
			}
			if (entry.chapterIndex === chapter) {
				best = entry;
			}
		}
		if (best && best.title) {
			return best.title;
		}
		return fallback;
	}

	updateOverlayProgressInfo(chapter, anchor, percentage) {
		const title = this.getSectionTitleForPosition(chapter, anchor);
		const displayTitle = reader.util.capText ? reader.util.capText(title, 60) : title;
		const target = reader.util.loadElem("#readerOverlaySmall > div");
		if (!target) {
			return;
		}
		target.innerHTML = `${this.normalizeProgressValue(percentage).toFixed(2)}%&nbsp;&bull;&nbsp;${displayTitle}`;
	}

	ensureImmersivePageMarkerLayer() {
		const linearEl = reader.util.loadElem("#readerLinear");
		if (!linearEl) {
			return null;
		}
		let layer = linearEl.querySelector("#immersivePageSyncLayer");
		if (!layer) {
			layer = document.createElement("div");
			layer.id = "immersivePageSyncLayer";
			layer.setAttribute("aria-live", "polite");
			layer.setAttribute("aria-atomic", "true");
			layer.setAttribute("role", "status");
			linearEl.insertBefore(layer, linearEl.firstChild || null);
		}
		return layer;
	}

	updateImmersivePageMarker(visibleColumnCount) {
		const layer = this.ensureImmersivePageMarkerLayer();
		if (!layer) {
			return;
		}
		const firstPage = Math.max(1, Number(this.page || 0) + 1);
		const cols = Math.max(1, Number(visibleColumnCount) || 1);
		const lastPage = firstPage + cols - 1;
		const key = `${firstPage}:${lastPage}`;
		if (key === this.lastImmersivePageMarkerKey) {
			return;
		}

		const marker = document.createElement("h2");
		marker.className = "epub-page-marker";
		marker.id = cols > 1 ? `page-${firstPage}-to-${lastPage}` : `page-${firstPage}`;
		marker.setAttribute("data-page", String(firstPage));
		if (cols > 1) {
			marker.setAttribute("data-page-end", String(lastPage));
		}
		marker.textContent = cols > 1
			? `Páginas ${firstPage} a ${lastPage}`
			: `Página ${firstPage}`;

		const oldMarker = layer.firstElementChild;
		if (oldMarker) {
			oldMarker.replaceWith(marker);
		} else {
			layer.appendChild(marker);
		}
		this.lastImmersivePageMarkerKey = key;
	}

	shouldHidePageNumbersForImmersive() {
		return false;
	}

	updateColumnMarkers() {
		if (!this.columnMarkers || !this.columnMarkerItems.length) return;
		const columnCount = this.getColumnCount();
		const visibleColumnCount = ((this.pageViewMode === "three" || this.pageViewMode === "four") && this.page < 2) ? 1 : columnCount;
		const expectedMarkerItems = this.getMarkerColumnCount() * 3;
		if (this.columnMarkerItems.length !== expectedMarkerItems) {
			if (this.columnMarkers) {
				this.columnMarkers.remove();
			}
			this.columnMarkers = null;
			this.columnMarkerItems = [];
			this.ensureColumnMarkers();
		}
		const containerRect = this.container.getBoundingClientRect();
		const baseTop = containerRect.top;
		const height = containerRect.height;
		const viewportEl = reader.util.loadElem("#readerSpread");
		if (!viewportEl) return;
		const spreadRect = viewportEl.getBoundingClientRect();
		const baseLeft = spreadRect.left;
		const width = spreadRect.width;
		const gap = this.getColumnGap();
		const paddingLeft = this.readerMarginPx || 25;
		const paddingRight = this.readerMarginPx || 25;
		const totalGaps = Math.max(0, visibleColumnCount - 1);
		const availableWidth = width - paddingLeft - paddingRight - gap * totalGaps;
		const columnWidth = availableWidth / Math.max(1, visibleColumnCount);
		const gapOffset = Math.min(14, Math.max(8, gap / 3));
		const sharedOffset = Math.min(gapOffset, Math.max(6, 25 - 4));
		const firstColumnExtraOffset = 22;

		this.columnMarkers.applyStyles({ "opacity": "1" });
		this.columnMarkerItems.forEach(item => {
			const col = parseInt(item.dataset.column, 10);
			if (col >= visibleColumnCount) {
				item.hide();
				return;
			}
			const columnRight = baseLeft + paddingLeft + columnWidth * (col + 1) + gap * col;
			const left = columnRight + sharedOffset + (col === 0 ? firstColumnExtraOffset : 0);
			const pos = parseFloat(item.dataset.pos);
			const top = baseTop + height * pos;
			item.show("block");
			item.applyStyles({
				"left": `${left}px`,
				"top": `${top}px`,
				"transform": "translateY(-50%)"
			});
		});
	}

	updatePageNumbers() {
		if (!this.pageNumbers || !this.pageNumberItems.length || !this.spreadElem) return;
		const visibleColumnCount = this.getVisibleColumnCountForCurrentPage();
		const ttsActive = this.hasActiveReadAloudHighlight();
		if (ttsActive) {
			this.pageNumberItems.forEach(item => item.hide());
			this.updateImmersivePageMarker(visibleColumnCount);
			return;
		}
		if (this.shouldHidePageNumbersForImmersive()) {
			this.pageNumberItems.forEach(item => item.hide());
			// Keep immersive page markers in sync even when visual page labels stay hidden.
			this.updateImmersivePageMarker(visibleColumnCount);
			return;
		}
		const visibleSpread = this.spreadDetached
			? (this.spreadClone || reader.util.loadElem("#readerSpreadClone"))
			: this.spreadElem;
		if (!visibleSpread) {
			return;
		}
		const spreadRect = visibleSpread.getBoundingClientRect();
		if (!spreadRect.width || !spreadRect.height) {
			this.updateImmersivePageMarker(visibleColumnCount);
			return;
		}
		const baseLeft = spreadRect.left;
		const width = spreadRect.width;
		const gap = this.getColumnGap();
		const paddingLeft = this.readerMarginPx || 25;
		const paddingRight = this.readerMarginPx || 25;
		const totalGaps = Math.max(0, visibleColumnCount - 1);
		const availableWidth = width - paddingLeft - paddingRight - gap * totalGaps;
		const columnWidth = availableWidth / Math.max(1, visibleColumnCount);
		const top = spreadRect.bottom - 56;
		const colCount = Math.max(1, this.getColumnCount());
		const spreadBasePage = Math.floor(Math.max(0, Number(this.page) || 0) / colCount) * colCount;

		this.pageNumberItems.forEach((item, index) => {
			if (index >= visibleColumnCount) {
				item.hide();
				return;
			}
			const center = baseLeft + paddingLeft + (columnWidth / 2) + index * (columnWidth + gap);
			item.innerText = String(spreadBasePage + index + 1);
			item.show("block");
			item.applyStyles({
				"left": `${center}px`,
				"top": `${top}px`,
				"transform": "translateX(-50%)",
				"opacity": "1"
			});
		});
		this.updateImmersivePageMarker(visibleColumnCount);
	}

	hasActiveReadAloudHighlight() {
		const hasHighlightMarker = root => !!root?.querySelector?.("mark.tts-highlight, .tts-highlight, .highlight");
		if (hasHighlightMarker(this.pageContent) || hasHighlightMarker(this.spreadClone)) {
			return true;
		}
		const selection = window.getSelection && window.getSelection();
		if (!selection || !selection.rangeCount) {
			return false;
		}
		const anchorElem = this.getSelectionAnchorElement(selection);
		if (!anchorElem) {
			return false;
		}
		const linearRoot = reader.util.loadElem("#readerLinear");
		if (this.spreadClone?.contains?.(anchorElem) || this.pageContent?.contains?.(anchorElem)) {
			return true;
		}
		return !!(linearRoot && linearRoot.contains(anchorElem));
	}

	setupReaderSearch() {
		const searchBox = reader.util.loadElem("#readerSearchBox");
		const searchInput = reader.util.loadElem("#readerSearchInput");
		const flagsInput = reader.util.loadElem("#readerSearchFlags");
		const searchMode = reader.util.loadElem("#readerSearchMode");
		const searchRun = reader.util.loadElem("#readerSearchRun");
		const searchClose = reader.util.loadElem("#readerSearchClose");
		const prevButton = reader.util.loadElem("#readerSearchPrev");
		const nextButton = reader.util.loadElem("#readerSearchNext");
		const status = reader.util.loadElem("#readerSearchStatus");
		if (!searchBox || !searchInput || !flagsInput || !searchMode || !searchRun || !searchClose || !prevButton || !nextButton || !status) return;

		searchBox.classList.remove("open");
		this.applyReaderSearchAppearance();
		this.updateSearchStatus("Sem resultados");
		prevButton.disabled = true;
		nextButton.disabled = true;

		if (this.searchKeyHandler) {
			searchInput.removeEventListener("input", this.searchKeyHandler);
		}
		this.searchKeyHandler = () => {
			window.clearTimeout(this.searchDebounceTimeout);
			this.searchDebounceTimeout = window.setTimeout(() => {
				this.runSearch();
			}, 300);
		};
		searchInput.addEventListener("input", this.searchKeyHandler);
		flagsInput.addEventListener("input", this.searchKeyHandler);
		searchMode.addEventListener("change", this.searchKeyHandler);
		searchRun.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			this.runSearch();
		});
		searchClose.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			this.closeReaderSearch();
		});

		if (!this.searchOptionHandler) {
			this.searchOptionHandler = () => {
				window.clearTimeout(this.searchDebounceTimeout);
				this.searchDebounceTimeout = window.setTimeout(() => {
					this.runSearch();
				}, 300);
			};
		}

		prevButton.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			this.navigateMatch(-1);
		});
		nextButton.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			this.navigateMatch(1);
		});

		searchInput.addEventListener("keydown", event => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeReaderSearch();
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				this.navigateMatch(event.shiftKey ? -1 : 1);
			}
		});

		[flagsInput, searchMode].forEach(control => control.addEventListener("keydown", event => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeReaderSearch();
			}
		}));

		this.restoreReaderSearchState(this.pendingReaderSearchState);
	}

	async applyReaderSearchAppearance() {
		const searchBox = reader.util.loadElem("#readerSearchBox");
		if (!searchBox) return;
		const fontFamily = String((await reader.store.loadSetting("readerSearchFontFamily")) || "Helvetica, Arial, sans-serif");
		const fontSize = Math.max(8, Math.min(24, Number(await reader.store.loadSetting("readerSearchFontSize")) || 16));
		const backgroundColor = String((await reader.store.loadSetting("readerSearchBackgroundColor")) || "#adff2f");
		const textColor = String((await reader.store.loadSetting("readerSearchTextColor")) || "#ffffff");
		const width = Math.max(420, Math.min(1400, Number(await reader.store.loadSetting("readerSearchWindowWidth")) || 960));
		const height = Math.max(180, Math.min(720, Number(await reader.store.loadSetting("readerSearchWindowHeight")) || 320));
		searchBox.style.setProperty("--reader-search-font-family", fontFamily);
		searchBox.style.setProperty("--reader-search-font-size", `${fontSize}pt`);
		searchBox.style.setProperty("--reader-search-bg", backgroundColor);
		searchBox.style.setProperty("--reader-search-text", textColor);
		searchBox.style.setProperty("--reader-search-width", `${width}px`);
		searchBox.style.setProperty("--reader-search-max-height", `${height}px`);
	}

	openReaderSearch() {
		const searchBox = reader.util.loadElem("#readerSearchBox");
		const searchInput = reader.util.loadElem("#readerSearchInput");
		if (!searchBox || !searchInput) return;
		searchBox.classList.add("open");
		document.body.classList.add("reader-search-open");
		reader.util.loadElem("#readerOverlayTop")?.applyStyles({ "opacity": 1 });
		reader.util.loadElem("#readerOverlayBottom")?.applyStyles({ "opacity": 1 });
		window.clearTimeout(this.overlayTimeout);
		searchInput.focus();
		searchInput.select();
		this.runSearch();
		this.saveReaderSearchState();
	}

	closeReaderSearch() {
		const searchBox = reader.util.loadElem("#readerSearchBox");
		const status = reader.util.loadElem("#readerSearchStatus");
		const prevButton = reader.util.loadElem("#readerSearchPrev");
		const nextButton = reader.util.loadElem("#readerSearchNext");
		if (!searchBox || !status || !prevButton || !nextButton) return;
		searchBox.classList.remove("open");
		document.body.classList.remove("reader-search-open");
		this.clearHighlights();
		this.updateSearchStatus("Sem resultados");
		prevButton.disabled = true;
		nextButton.disabled = true;
		this.renderSearchResultsList();
		this.saveReaderSearchState();
	}

	saveReaderSearchState() {
		if (!reader?.interface?.saveReaderSearchState || !this.book) {
			return;
		}
		const searchBox = reader.util.loadElem("#readerSearchBox");
		const searchInput = reader.util.loadElem("#readerSearchInput");
		const searchMode = reader.util.loadElem("#readerSearchMode");
		const flagsInput = reader.util.loadElem("#readerSearchFlags");
		reader.interface.saveReaderSearchState(this.book.title, {
			open: !!searchBox?.classList.contains("open"),
			query: String(searchInput?.value || ""),
			mode: String(searchMode?.value || "keyword"),
			flags: String(flagsInput?.value || "giu")
		});
	}

	restoreReaderSearchState(state) {
		this.pendingReaderSearchState = state && typeof state === "object" ? { ...state } : null;
		const searchInput = reader.util.loadElem("#readerSearchInput");
		const searchMode = reader.util.loadElem("#readerSearchMode");
		const flagsInput = reader.util.loadElem("#readerSearchFlags");
		if (!searchInput || !searchMode || !flagsInput) {
			return;
		}
		const nextState = this.pendingReaderSearchState || {};
		searchInput.value = String(nextState.query || "");
		searchMode.value = nextState.mode === "regex" ? "regex" : "keyword";
		flagsInput.value = String(nextState.flags || "giu");
		if (nextState.open) {
			this.openReaderSearch();
			return;
		}
		this.runSearch();
	}

	getSearchMode() {
		const searchMode = reader.util.loadElem("#readerSearchMode");
		return searchMode?.value === "regex" ? "regex" : "keyword";
	}

	normalizeSearchNumberText(value) {
		return String(value || "")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[.,;:!?()[\]{}]/g, " ")
			.replace(/[-_/]+/g, " ")
			.replace(/\b(?:pagina|paginas|pag|page|pages|capitulo|capitulos|chapter|chapters|numero|numeros|number|numbers|no|n)\b/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	parseRomanNumeral(token) {
		const normalized = String(token || "").trim().toUpperCase();
		if (!/^[IVXLCDM]+$/.test(normalized)) {
			return null;
		}
		const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
		let total = 0;
		let previous = 0;
		for (let i = normalized.length - 1; i >= 0; i--) {
			const current = values[normalized[i]] || 0;
			if (current < previous) {
				total -= current;
			} else {
				total += current;
				previous = current;
			}
		}
		return total > 0 ? total : null;
	}

	parseSpelledNumber(text) {
		const rawCandidate = String(text || "")
			.trim()
			.replace(/^(?:pagina|paginas|pag|page|pages|capitulo|capitulos|chapter|chapters)\s+/i, "")
			.trim();
		const normalized = this.normalizeSearchNumberText(text);
		if (!normalized) return null;
		const ordinalDigitMatch = normalized.match(/\b(\d+)\s*(?:st|nd|rd|th|o|a|os|as|º|ª)\b/);
		if (ordinalDigitMatch) {
			return Number(ordinalDigitMatch[1]) || null;
		}
		const digitMatch = normalized.match(/\b\d+\b/);
		if (digitMatch) {
			return Number(digitMatch[0]) || null;
		}
		const roman = /^[IVXLCDM]+$/.test(rawCandidate) ? this.parseRomanNumeral(rawCandidate) : null;
		if (roman) {
			return roman;
		}

		const ignored = new Set(["e", "and", "de", "da", "do", "dos", "das", "the", "parte", "partes", "part", "secao", "secoes", "section", "sections", "livro", "livros", "book", "books", "volume", "volumes", "vol"]);
		const values = {
			zero: 0, um: 1, uma: 1, one: 1, primeiro: 1, primeira: 1, first: 1,
			dois: 2, duas: 2, two: 2, segundo: 2, segunda: 2, second: 2,
			tres: 3, three: 3, terceiro: 3, terceira: 3, third: 3,
			quatro: 4, four: 4, quarto: 4, quarta: 4, fourth: 4,
			cinco: 5, five: 5, quinto: 5, quinta: 5, fifth: 5,
			seis: 6, six: 6, sexto: 6, sexta: 6, sixth: 6,
			sete: 7, seven: 7, setimo: 7, setima: 7, seventh: 7,
			oito: 8, eight: 8, oitavo: 8, oitava: 8, eighth: 8,
			nove: 9, nine: 9, nono: 9, nona: 9, ninth: 9,
			dez: 10, ten: 10, decimo: 10, decima: 10, tenth: 10,
			onze: 11, eleven: 11, undecimo: 11, undecima: 11, eleventh: 11,
			doze: 12, twelve: 12, duodecimo: 12, duodecima: 12, twelfth: 12,
			treze: 13, thirteen: 13, thirteenth: 13,
			catorze: 14, quatorze: 14, fourteen: 14, fourteenth: 14,
			quinze: 15, fifteen: 15, fifteenth: 15,
			dezesseis: 16, dezasseis: 16, sixteen: 16, sixteenth: 16,
			dezessete: 17, dezassete: 17, seventeen: 17, seventeenth: 17,
			dezoito: 18, eighteen: 18, eighteenth: 18,
			dezenove: 19, nineteen: 19, nineteenth: 19,
			vinte: 20, twenty: 20, vigesimo: 20, vigesima: 20, twentieth: 20,
			trinta: 30, thirty: 30, trigesimo: 30, trigesima: 30, thirtieth: 30,
			quarenta: 40, forty: 40, quadragesimo: 40, quadragesima: 40, fortieth: 40,
			cinquenta: 50, fifty: 50, quinquagesimo: 50, quinquagesima: 50, fiftieth: 50,
			sessenta: 60, sixty: 60, sexagesimo: 60, sexagesima: 60, sixtieth: 60,
			setenta: 70, seventy: 70, septuagesimo: 70, septuagesima: 70, seventieth: 70,
			oitenta: 80, eighty: 80, octogesimo: 80, octogesima: 80, eightieth: 80,
			noventa: 90, ninety: 90, nonagesimo: 90, nonagesima: 90, ninetieth: 90
		};
		const multipliers = {
			cem: 100, cento: 100, hundred: 100, centesimo: 100, centesima: 100, hundredth: 100,
			mil: 1000, thousand: 1000, milesimo: 1000, milesima: 1000, thousandth: 1000
		};
		const hundreds = {
			duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
			quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
			oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900
		};

		const tokens = normalized.split(" ").filter(Boolean);
		for (const token of tokens) {
			const tokenRoman = this.parseRomanNumeral(token);
			if (tokenRoman) {
				return tokenRoman;
			}
		}
		let total = 0;
		let current = 0;
		let matched = false;
		for (const token of tokens) {
			if (ignored.has(token)) continue;
			if (Object.prototype.hasOwnProperty.call(hundreds, token)) {
				current += hundreds[token];
				matched = true;
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(values, token)) {
				current += values[token];
				matched = true;
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(multipliers, token)) {
				const multiplier = multipliers[token];
				current = (current || 1) * multiplier;
				if (multiplier >= 1000) {
					total += current;
					current = 0;
				}
				matched = true;
				continue;
			}
			return null;
		}
		if (!matched) return null;
		return total + current;
	}

	resolveNumericSearch(queryText) {
		const value = this.parseSpelledNumber(queryText);
		if (!Number.isFinite(value) || value <= 0) {
			return null;
		}
		return Math.floor(value);
	}

	getSearchChapterEntries() {
		const entries = [];
		const seen = new Set();
		if (Array.isArray(this.tocAnchorMap) && this.tocAnchorMap.length) {
			for (const entry of this.tocAnchorMap) {
				if (!entry || !Number.isFinite(Number(entry.anchorIndex))) continue;
				const key = `${Number(entry.anchorIndex)}::${String(entry.title || "").trim()}`;
				if (seen.has(key)) continue;
				seen.add(key);
				entries.push({
					title: String(entry.title || "").trim(),
					chapterIndex: Math.max(0, Number(entry.chapterIndex) || 0),
					anchorIndex: Number(entry.anchorIndex)
				});
			}
			return entries;
		}
		if (!Array.isArray(this.book?.contents)) {
			return entries;
		}
		for (let chapterIndex = 0; chapterIndex < this.book.contents.length; chapterIndex++) {
			entries.push({
				title: String(this.book.contents[chapterIndex]?.title || "").trim(),
				chapterIndex,
				anchorIndex: Number(this.getChapterStartGlobalAnchor(chapterIndex)) || 0
			});
		}
		return entries;
	}

	findChapterSearchTarget(queryText, numericValue) {
		const normalizedQuery = this.normalizeSearchNumberText(queryText);
		if (!normalizedQuery && !numericValue) {
			return null;
		}
		if ((!Array.isArray(this.tocAnchorMap) || !this.tocAnchorMap.length) && this.pageContent) {
			this.buildTocAnchorMap();
		}
		const entries = this.getSearchChapterEntries();
		let best = null;
		for (const entry of entries) {
			const normalizedTitle = this.normalizeSearchNumberText(entry.title);
			const titleNumber = this.resolveNumericSearch(entry.title);
			let score = -1;
			if (normalizedQuery && normalizedTitle) {
				if (normalizedTitle === normalizedQuery) {
					score = 400;
				} else if (normalizedTitle.startsWith(`${normalizedQuery} `) || normalizedTitle.endsWith(` ${normalizedQuery}`)) {
					score = 320;
				} else if (normalizedTitle.includes(normalizedQuery)) {
					score = 240;
				}
			}
			if (numericValue) {
				if (titleNumber === numericValue) {
					score = Math.max(score, 380);
				}
				if ((entry.chapterIndex + 1) === numericValue) {
					score = Math.max(score, 260);
				}
			}
			if (score < 0) continue;
			if (!best || score > best.score || (score === best.score && entry.anchorIndex < best.anchorIndex)) {
				best = { ...entry, score };
			}
		}
		if (!best) {
			return null;
		}
		return {
			type: "chapter",
			chapterAnchor: best.anchorIndex,
			chapterIndex: best.chapterIndex,
			label: best.title || this.getChapterLabelByIndex(best.chapterIndex)
		};
	}

	getChapterLabelByIndex(chapterIndex) {
		const safeIndex = Math.max(0, Number(chapterIndex) || 0);
		const title = this.getSectionTitleForPosition(safeIndex, 0);
		if (title && title !== "CapÃƒÆ’Ã‚Â­tulo sem tÃƒÆ’Ã‚Â­tulo") {
			return title;
		}
		return `CapÃ­tulo ${safeIndex + 1}`;
	}

	async buildPriorityTargets(queryText) {
		const numericValue = this.resolveNumericSearch(queryText);
		if (!numericValue) {
			return [];
		}

		const targets = [];
		const targetPageIndex = Math.max(0, numericValue - 1);
		targets.push({
			type: "page",
			pageIndex: targetPageIndex,
			pageNumber: numericValue,
			label: `PÃ¡gina ${numericValue}`
		});

		if (this.book?.contents?.length) {
			let inferredChapter = 0;
			for (let chapterIndex = 0; chapterIndex < this.book.contents.length; chapterIndex++) {
				const chapterPage = await this.getPageFromAnchor(this.getChapterStartGlobalAnchor(chapterIndex));
				if (chapterPage > targetPageIndex) {
					break;
				}
				inferredChapter = chapterIndex;
			}
			targets.push({
				type: "chapter",
				chapterAnchor: this.getChapterStartGlobalAnchor(inferredChapter),
				chapterIndex: inferredChapter,
				pageNumber: numericValue,
				label: this.getChapterLabelByIndex(inferredChapter)
			});
		}
		return targets;
	}

	getChapterLabelByIndex(chapterIndex) {
		const safeIndex = Math.max(0, Number(chapterIndex) || 0);
		const title = this.getSectionTitleForPosition(safeIndex, 0);
		if (title && title !== "Capitulo sem titulo") {
			return title;
		}
		return `Capitulo ${safeIndex + 1}`;
	}

	async buildPriorityTargets(queryText) {
		const numericValue = this.resolveNumericSearch(queryText);
		const chapterTarget = this.findChapterSearchTarget(queryText, numericValue);
		if (!numericValue && !chapterTarget) {
			return [];
		}

		const targets = [];
		if (numericValue) {
			const targetPageIndex = Math.max(0, numericValue - 1);
			targets.push({
				type: "page",
				pageIndex: targetPageIndex,
				pageNumber: numericValue,
				label: `Pagina ${numericValue}`
			});
		}
		if (chapterTarget) {
			targets.push({
				...chapterTarget,
				pageNumber: numericValue || null
			});
		}
		return targets;
	}

	async jumpToPageByNumber(pageNumber) {
		const maxPage = Math.max(0, await this.getMaxPage());
		const target = Math.max(0, Math.min(maxPage, Number(pageNumber) || 0));
		this.page = target;
		this.applyPageOffset();
		this.position.anchor = this.getAnchor();
		const current = this.getCurrentChapterAndAnchor();
		this.position.chapter = current.chapter;
		await this.onResize(true);
	}

	buildPriorityTargetsLegacy(queryText) {
		const pageFilter = reader.util.loadElem("#readerSearchFilterPage");
		const chapterFilter = reader.util.loadElem("#readerSearchFilterChapter");
		if (!pageFilter || !chapterFilter) {
			return [];
		}

		const numericQuery = String(queryText || "").trim().match(/^\d+$/);
		if (!numericQuery) {
			return [];
		}

		const requested = Math.max(1, parseInt(numericQuery[0], 10));
		const targets = [];
		if (pageFilter.checked) {
			targets.push({
				type: "page",
				pageIndex: requested - 1,
				label: `Página ${requested}`
			});
		}
		if (chapterFilter.checked && this.book?.contents?.length) {
			const chapterIndex = requested - 1;
			if (chapterIndex >= 0 && chapterIndex < this.book.contents.length) {
				targets.push({
					type: "chapter",
					chapterAnchor: this.getChapterStartGlobalAnchor(chapterIndex),
					chapterIndex,
					label: `Capítulo ${requested}`
				});
			}
		}
		return targets;
	}

	buildTextIndex() {
		const root = reader.util.loadElem("#epub-content") || this.pageContent;
		if (!root) {
			return { text: "", segments: [] };
		}
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: node => {
				if (!node || !node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest("mark.epub-search-hit")) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName;
				if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		let current = walker.nextNode();
		const parts = [];
		const segments = [];
		let cursor = 0;
		while (current) {
			const text = current.nodeValue || "";
			const start = cursor;
			cursor += text.length;
			parts.push(text);
			segments.push({ node: current, start, end: cursor });
			current = walker.nextNode();
		}
		return { text: parts.join(""), segments };
	}

	escapeRegex(rawText) {
		return String(rawText || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	getSearchRegex() {
		const patternInput = reader.util.loadElem("#readerSearchInput");
		const flagsInput = reader.util.loadElem("#readerSearchFlags");
		const regexMode = reader.util.loadElem("#readerSearchRegexMode");
		const caseInsensitive = reader.util.loadElem("#readerSearchCaseInsensitive");
		const wholeWord = reader.util.loadElem("#readerSearchWholeWord");
		const properNoun = reader.util.loadElem("#readerSearchProperNoun");
		const dateShortcut = reader.util.loadElem("#readerSearchDate");
		if (!patternInput || !flagsInput || !regexMode || !caseInsensitive || !wholeWord || !properNoun || !dateShortcut) {
			return { regex: null, error: "Controles de busca indisponíveis.", empty: true };
		}

		const rawPattern = String(patternInput.value || "").trim();
		const shortcutPatterns = [];
		if (properNoun.checked) {
			shortcutPatterns.push("\\b[A-Z][a-z]+\\b");
		}
		if (dateShortcut.checked) {
			shortcutPatterns.push("\\b(?:\\d{4}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},\\s*\\d{4})\\b");
		}

		if (!rawPattern && !shortcutPatterns.length) {
			return { regex: null, empty: true };
		}

		if (rawPattern.length > 500) {
			return { regex: null, error: "Padrão muito longo. O limite é 500 caracteres.", empty: false };
		}

		let typedPattern = rawPattern;
		if (!regexMode.checked) {
			typedPattern = this.escapeRegex(typedPattern);
		}
		if (typedPattern && wholeWord.checked) {
			typedPattern = `\\b(?:${typedPattern})\\b`;
		}

		const compiledParts = [];
		if (typedPattern) {
			compiledParts.push(`(?:${typedPattern})`);
		}
		compiledParts.push(...shortcutPatterns.map(part => `(?:${part})`));

		let flags = String(flagsInput.value || "").replace(/[^gimsuy]/g, "");
		if (caseInsensitive.checked && !flags.includes("i")) {
			flags += "i";
		}
		if (!flags.includes("g")) {
			flags += "g";
		}
		flags = [...new Set(flags.split(""))].join("");

		try {
			return {
				regex: new RegExp(compiledParts.join("|"), flags),
				empty: false,
				error: null
			};
		} catch (_err) {
			return { regex: null, error: "Expressão regular inválida.", empty: false };
		}
	}

	updateSearchStatus(text, resultType = "") {
		const status = reader.util.loadElem("#readerSearchStatus");
		if (status) {
			status.classList.remove("result-page", "result-chapter", "result-keyword", "result-regex");
			if (resultType === "page") status.classList.add("result-page");
			if (resultType === "chapter") status.classList.add("result-chapter");
			if (resultType === "keyword") status.classList.add("result-keyword");
			if (resultType === "regex") status.classList.add("result-regex");
			status.textContent = text;
		}
	}

	formatSearchTotal(total) {
		return this.searchLimitReached ? `${total}+` : String(total);
	}

	setSearchNavDisabled(disabled) {
		const prevButton = reader.util.loadElem("#readerSearchPrev");
		const nextButton = reader.util.loadElem("#readerSearchNext");
		if (prevButton) prevButton.disabled = disabled;
		if (nextButton) nextButton.disabled = disabled;
	}

	renderSearchResultsList() {
		const container = reader.util.loadElem("#readerSearchResults");
		if (!container) return;
		container.innerHTML = "";
		container.classList.remove("has-results");
		if (!this.searchOrderedResults.length) return;
		container.classList.add("has-results");
		const totalLabel = this.formatSearchTotal(this.searchOrderedResults.length);
		this.searchOrderedResults.forEach((result, index) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `readerSearchResultItem type-${result.type}`;
			btn.setAttribute("data-result-index", String(index));
			btn.textContent = `${index + 1} / ${totalLabel} • ${result.label || ""}`;
			if (index === this.activeSearchResultIndex) {
				btn.classList.add("active");
			}
			btn.addEventListener("click", () => {
				this.activeSearchResultIndex = index - 1;
				this.navigateMatch(1, false);
			});
			container.appendChild(btn);
		});
	}

	runSearchLegacy() {
		const patternInput = reader.util.loadElem("#readerSearchInput");
		const regexMode = reader.util.loadElem("#readerSearchRegexMode");
		const queryText = String(patternInput?.value || "").trim();
		const { regex, error, empty } = this.getSearchRegex();
		this.clearHighlights();
		this.searchLimitReached = false;
		this.searchOrderedResults = [];
		this.activeSearchResultIndex = -1;

		const priorityTargets = this.buildPriorityTargets(queryText);
		const textResultType = regexMode && regexMode.checked ? "regex" : "keyword";

		if (error) {
			if (!priorityTargets.length) {
				this.updateSearchStatus(error);
				this.setSearchNavDisabled(true);
				this.renderSearchResultsList();
				return;
			}
		}

		let ranges = [];
		if (!empty && regex) {
			const index = this.buildTextIndex();
			if (index.text) {
				const maxMatches = 2000;
				let iterations = 0;
				regex.lastIndex = 0;
				let match = regex.exec(index.text);
				while (match && iterations < maxMatches) {
					const start = match.index;
					const size = match[0] ? match[0].length : 0;
					const end = Math.min(index.text.length, start + Math.max(1, size));
					if (end > start) {
						ranges.push({ start, end });
					}
					if (size === 0) {
						regex.lastIndex = start + 1;
					}
					iterations += 1;
					match = regex.exec(index.text);
				}
				this.searchLimitReached = iterations >= maxMatches && !!match;
				this.searchMatches = ranges;
				if (ranges.length) {
					this.highlightRanges(ranges, index);
				}
			}
		}

		const textResults = ranges.map((_range, index) => ({
			type: textResultType,
			matchIndex: index,
			label: textResultType === "regex" ? "Regex" : "Palavra-chave"
		}));
		this.searchOrderedResults = [...priorityTargets, ...textResults];

		if (!this.searchOrderedResults.length) {
			this.updateSearchStatus("Sem resultados");
			this.setSearchNavDisabled(true);
			this.renderSearchResultsList();
			return;
		}
		this.setSearchNavDisabled(false);
		this.navigateMatch(1, true);
		this.renderSearchResultsList();
	}

	getSearchRegex() {
		const patternInput = reader.util.loadElem("#readerSearchInput");
		const flagsInput = reader.util.loadElem("#readerSearchFlags");
		if (!patternInput || !flagsInput) {
			return { regex: null, error: "Controles de busca indisponiveis.", empty: true };
		}

		const rawPattern = String(patternInput.value || "").trim();
		if (!rawPattern) {
			return { regex: null, empty: true };
		}
		if (rawPattern.length > 500) {
			return { regex: null, error: "Padrao muito longo. O limite e 500 caracteres.", empty: false };
		}

		let typedPattern = rawPattern;
		if (this.getSearchMode() !== "regex") {
			typedPattern = this.escapeRegex(typedPattern);
		}

		let flags = String(flagsInput.value || "").replace(/[^gimsuy]/g, "");
		if (!flags.includes("g")) {
			flags += "g";
		}
		flags = [...new Set(flags.split(""))].join("");

		try {
			return {
				regex: new RegExp(typedPattern, flags),
				empty: false,
				error: null
			};
		} catch (_err) {
			return { regex: null, error: "Expressao regular invalida.", empty: false };
		}
	}

	renderSearchResultsList() {
		const container = reader.util.loadElem("#readerSearchResults");
		if (!container) return;
		container.innerHTML = "";
		container.classList.remove("has-results");
		if (!this.searchOrderedResults.length) return;
		container.classList.add("has-results");
		const totalLabel = this.formatSearchTotal(this.searchOrderedResults.length);
		this.searchOrderedResults.forEach((result, index) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `readerSearchResultItem type-${result.type}`;
			btn.setAttribute("data-result-index", String(index));
			btn.textContent = result.type === "page" || result.type === "chapter"
				? `${result.label || ""}`
				: `${index + 1} / ${totalLabel} - ${result.label || ""}`;
			if (index === this.activeSearchResultIndex) {
				btn.classList.add("active");
			}
			btn.addEventListener("click", () => {
				this.activeSearchResultIndex = index - 1;
				void this.navigateMatch(1, false);
			});
			container.appendChild(btn);
		});
	}

	renderSearchResultsList() {
		const container = reader.util.loadElem("#readerSearchResults");
		if (!container) return;
		container.innerHTML = "";
		container.classList.remove("has-results");
		if (!this.searchOrderedResults.length) return;
		container.classList.add("has-results");
		const totalLabel = this.formatSearchTotal(this.searchOrderedResults.length);
		this.searchOrderedResults.forEach((result, index) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `readerSearchResultItem type-${result.type}`;
			btn.setAttribute("data-result-index", String(index));
			btn.textContent = result.type === "page" || result.type === "chapter"
				? `${result.label || ""}`
				: `${index + 1} / ${totalLabel} | ${result.label || ""}`;
			if (index === this.activeSearchResultIndex) {
				btn.classList.add("active");
			}
			btn.addEventListener("click", () => {
				this.activeSearchResultIndex = index - 1;
				void this.navigateMatch(1, false);
			});
			container.appendChild(btn);
		});
	}

	async runSearch() {
		const patternInput = reader.util.loadElem("#readerSearchInput");
		const queryText = String(patternInput?.value || "").trim();
		const { regex, error, empty } = this.getSearchRegex();
		this.clearHighlights();
		this.searchLimitReached = false;
		this.searchOrderedResults = [];
		this.activeSearchResultIndex = -1;
		this.saveReaderSearchState();

		const priorityTargets = await this.buildPriorityTargets(queryText);
		const textResultType = this.getSearchMode() === "regex" ? "regex" : "keyword";

		if (error && !priorityTargets.length) {
			this.updateSearchStatus(error);
			this.setSearchNavDisabled(true);
			this.renderSearchResultsList();
			return;
		}

		let ranges = [];
		if (!empty && regex) {
			const index = this.buildTextIndex();
			if (index.text) {
				const maxMatches = 2000;
				let iterations = 0;
				regex.lastIndex = 0;
				let match = regex.exec(index.text);
				while (match && iterations < maxMatches) {
					const start = match.index;
					const size = match[0] ? match[0].length : 0;
					const end = Math.min(index.text.length, start + Math.max(1, size));
					if (end > start) {
						ranges.push({ start, end });
					}
					if (size === 0) {
						regex.lastIndex = start + 1;
					}
					iterations += 1;
					match = regex.exec(index.text);
				}
				this.searchLimitReached = iterations >= maxMatches && !!match;
				this.searchMatches = ranges;
				if (ranges.length) {
					this.highlightRanges(ranges, index);
				}
			}
		}

		const textResults = ranges.map((_range, index) => ({
			type: textResultType,
			matchIndex: index,
			label: textResultType === "regex" ? "Regex" : "Palavra-chave"
		}));
		this.searchOrderedResults = [...priorityTargets, ...textResults];

		if (!this.searchOrderedResults.length) {
			this.updateSearchStatus("Sem resultados");
			this.setSearchNavDisabled(true);
			this.renderSearchResultsList();
			return;
		}
		this.setSearchNavDisabled(false);
		await this.navigateMatch(1, true);
		this.renderSearchResultsList();
	}

	highlightRanges(ranges, index) {
		const intervalsByNode = new Map();
		const nodeCursorByRange = 0;
		let segmentCursor = nodeCursorByRange;

		for (let matchIndex = 0; matchIndex < ranges.length; matchIndex++) {
			const range = ranges[matchIndex];
			while (segmentCursor < index.segments.length && index.segments[segmentCursor].end <= range.start) {
				segmentCursor += 1;
			}
			let segmentIndex = segmentCursor;
			while (segmentIndex < index.segments.length) {
				const segment = index.segments[segmentIndex];
				if (segment.start >= range.end) break;
				const localStart = Math.max(0, range.start - segment.start);
				const localEnd = Math.min(segment.end, range.end) - segment.start;
				if (localEnd > localStart) {
					if (!intervalsByNode.has(segment.node)) {
						intervalsByNode.set(segment.node, []);
					}
					intervalsByNode.get(segment.node).push({ start: localStart, end: localEnd, matchIndex });
				}
				segmentIndex += 1;
			}
		}

		this.searchMatchNodes = Array.from({ length: ranges.length }, () => []);
		intervalsByNode.forEach((intervals, node) => {
			intervals.sort((a, b) => b.start - a.start);
			let workingNode = node;
			for (let i = 0; i < intervals.length; i++) {
				const interval = intervals[i];
				if (!workingNode || !workingNode.parentNode || interval.start >= workingNode.length) {
					continue;
				}
				const safeEnd = Math.min(interval.end, workingNode.length);
				if (safeEnd <= interval.start) {
					continue;
				}
				const middle = workingNode.splitText(interval.start);
				const tail = middle.splitText(safeEnd - interval.start);
				const mark = document.createElement("mark");
				mark.className = "epub-search-hit";
				mark.setAttribute("data-match-index", String(interval.matchIndex));
				middle.parentNode.insertBefore(mark, tail);
				mark.appendChild(middle);
				this.searchMatchNodes[interval.matchIndex].push(mark);
			}
		});
	}

	clearHighlights() {
		const root = reader.util.loadElem("#epub-content") || this.pageContent;
		if (!root) {
			this.searchMatches = [];
			this.searchMatchNodes = [];
			this.activeSearchMatchIndex = -1;
			this.searchLimitReached = false;
			this.searchOrderedResults = [];
			this.activeSearchResultIndex = -1;
			return;
		}
		root.querySelectorAll("mark.epub-search-hit").forEach(mark => {
			const textNode = document.createTextNode(mark.textContent || "");
			mark.replaceWith(textNode);
		});
		root.normalize();
		this.searchMatches = [];
		this.searchMatchNodes = [];
		this.activeSearchMatchIndex = -1;
		this.searchLimitReached = false;
		this.searchOrderedResults = [];
		this.activeSearchResultIndex = -1;
	}

	async navigateMatch(direction, fromStart = false) {
		if (!this.searchOrderedResults.length) {
			this.updateSearchStatus("Sem resultados");
			this.setSearchNavDisabled(true);
			this.renderSearchResultsList();
			return;
		}

		const previousResult = this.activeSearchResultIndex >= 0 ? this.searchOrderedResults[this.activeSearchResultIndex] : null;
		if (previousResult && (previousResult.type === "keyword" || previousResult.type === "regex") && this.searchMatchNodes[previousResult.matchIndex]) {
			this.searchMatchNodes[previousResult.matchIndex].forEach(mark => mark.classList.remove("active"));
		}

		const total = this.searchOrderedResults.length;
		let nextIndex = this.activeSearchResultIndex;
		if (fromStart || nextIndex < 0) {
			nextIndex = direction < 0 ? total - 1 : 0;
		} else {
			nextIndex = (nextIndex + (direction < 0 ? -1 : 1) + total) % total;
		}

		this.activeSearchResultIndex = nextIndex;
		const activeResult = this.searchOrderedResults[nextIndex];
		let statusSuffix = activeResult.label || "";

		if (activeResult.type === "page") {
			await this.jumpToPageByNumber(activeResult.pageIndex);
		} else if (activeResult.type === "chapter") {
			const chapterPage = await this.getPageFromAnchor(activeResult.chapterAnchor);
			await this.jumpToPageByNumber(chapterPage);
			statusSuffix = `Capítulo ${activeResult.chapterIndex + 1}`;
		} else if (activeResult.type === "keyword" || activeResult.type === "regex") {
			this.activeSearchMatchIndex = activeResult.matchIndex;
			const activeMarks = this.searchMatchNodes[activeResult.matchIndex] || [];
			activeMarks.forEach(mark => mark.classList.add("active"));
			if (activeMarks[0]) {
				activeMarks[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
			}
		}
		const totalLabel = this.formatSearchTotal(total);
		this.updateSearchStatus(`${nextIndex + 1} / ${totalLabel}${statusSuffix ? ` • ${statusSuffix}` : ""}`, activeResult.type);
		this.renderSearchResultsList();
	}

	async navigateMatch(direction, fromStart = false) {
		if (!this.searchOrderedResults.length) {
			this.updateSearchStatus("Sem resultados");
			this.setSearchNavDisabled(true);
			this.renderSearchResultsList();
			return;
		}

		const previousResult = this.activeSearchResultIndex >= 0 ? this.searchOrderedResults[this.activeSearchResultIndex] : null;
		if (previousResult && (previousResult.type === "keyword" || previousResult.type === "regex") && this.searchMatchNodes[previousResult.matchIndex]) {
			this.searchMatchNodes[previousResult.matchIndex].forEach(mark => mark.classList.remove("active"));
		}

		const total = this.searchOrderedResults.length;
		let nextIndex = this.activeSearchResultIndex;
		if (fromStart || nextIndex < 0) {
			nextIndex = direction < 0 ? total - 1 : 0;
		} else {
			nextIndex = (nextIndex + (direction < 0 ? -1 : 1) + total) % total;
		}

		this.activeSearchResultIndex = nextIndex;
		const activeResult = this.searchOrderedResults[nextIndex];
		let statusSuffix = activeResult.label || "";

		if (activeResult.type === "page") {
			await this.jumpToPageByNumber(activeResult.pageIndex);
		} else if (activeResult.type === "chapter") {
			const chapterPage = await this.getPageFromAnchor(activeResult.chapterAnchor);
			await this.jumpToPageByNumber(chapterPage);
			statusSuffix = activeResult.label || `Capitulo ${activeResult.chapterIndex + 1}`;
		} else if (activeResult.type === "keyword" || activeResult.type === "regex") {
			this.activeSearchMatchIndex = activeResult.matchIndex;
			const activeMarks = this.searchMatchNodes[activeResult.matchIndex] || [];
			activeMarks.forEach(mark => mark.classList.add("active"));
			if (activeMarks[0]) {
				activeMarks[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
			}
		}
		const totalLabel = this.formatSearchTotal(total);
		this.updateSearchStatus(`${nextIndex + 1} / ${totalLabel}${statusSuffix ? ` | ${statusSuffix}` : ""}`, activeResult.type);
		this.renderSearchResultsList();
	}

	async close() {
		await this.persistReadingState(true);
		this.saveImmersiveWordFromCurrentSelection(true);
		document.body.classList.remove("reader-search-open");
		this.clearHighlights();
		this.stopSelectionCapture();
		this.listeners.forEach(l => reader.inputManager.removeListener(l[0], l[1]));
		window.clearTimeout(this.overlayTimeout);
		window.clearTimeout(this.positionSaveTimeout);
		window.clearTimeout(this.columnMarkersTimeout);
		window.clearTimeout(this.immersiveWordSaveTimeout);
		window.clearTimeout(this.immersiveObserverSyncTimer);
		if (this.immersiveSyncFrame) {
			window.cancelAnimationFrame(this.immersiveSyncFrame);
			this.immersiveSyncFrame = 0;
		}
		window.clearTimeout(this.immersiveCloneViewportTimer);
		window.clearTimeout(this.readingStateSaveTimeout);
		window.clearTimeout(this.positionPersistTimeout);
		window.clearTimeout(this.searchDebounceTimeout);
		window.clearTimeout(this.navEdgesHideTimeout);
		this.clearNavEdgeTimers();
		window.clearTimeout(this.navEdgesHideTimeout);
		this.hideNavEdge("left");
		this.hideNavEdge("right");
		document.body.classList.remove("reader-nav-hidden");
		if (this.navDocumentMouseMoveHandler) {
			window.removeEventListener("mousemove", this.navDocumentMouseMoveHandler, true);
			document.removeEventListener("mousemove", this.navDocumentMouseMoveHandler, true);
			this.navDocumentMouseMoveHandler = null;
		}
		if (this.navDocumentMouseLeaveHandler) {
			document.removeEventListener("mouseleave", this.navDocumentMouseLeaveHandler, true);
			this.navDocumentMouseLeaveHandler = null;
		}
		this.stopReadingTimer();
		this.stopAutoPageAdvance();
		this.stopLinearSync();
		if (this.synopsisFetchController) {
			this.synopsisFetchController.abort();
			this.synopsisFetchController = null;
		}
		if (this.synopsisSidebarElem) {
			this.synopsisSidebarElem.remove();
			this.synopsisSidebarElem = null;
			this.synopsisSidebarBodyElem = null;
			this.synopsisSidebarStatusElem = null;
		}
		this.synopsisSidebarVisible = false;
		this.synopsisFetchCache = null;
		if (this.columnMarkers) {
			this.columnMarkers.remove();
			this.columnMarkers = null;
			this.columnMarkerItems = [];
		}
		if (this.pageNumbers) {
			this.pageNumbers.remove();
			this.pageNumbers = null;
			this.pageNumberItems = [];
		}
		const immersivePageSyncLayer = reader.util.loadElem("#immersivePageSyncLayer");
		if (immersivePageSyncLayer) {
			immersivePageSyncLayer.remove();
		}
		this.lastImmersivePageMarkerKey = "";
		if (this.immersiveReaderObserver) {
			this.immersiveReaderObserver.disconnect();
			this.immersiveReaderObserver = null;
		}
		if (this.pageObserver) {
			this.pageObserver.disconnect();
			this.pageObserver = null;
		}
		this.pageSentinelVisibility = new Map();
		if (this.keyNavigationHandler) {
			window.removeEventListener("keydown", this.keyNavigationHandler, true);
			this.keyNavigationHandler = null;
		}
		this.listeners = [];
		this.immersiveObserverSyncTimer = null;
		this.immersiveCloneViewportTimer = null;
	}

	getSynopsisSidebarFraction() {
		return this.synopsisSidebarWidth === "half" ? 0.5 : (1 / 3);
	}

	updateSynopsisSidebarLayout() {
		if (!this.synopsisSidebarElem) {
			return;
		}
		const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 1200;
		const desired = Math.round(viewportWidth * this.getSynopsisSidebarFraction());
		const width = Math.max(300, Math.min(900, desired));
		this.synopsisSidebarElem.style.width = `${width}px`;
	}

	ensureSynopsisSidebar() {
		if (this.synopsisSidebarElem) {
			return this.synopsisSidebarElem;
		}
		const host = reader.util.loadElem("#reader");
		if (!host) {
			return null;
		}
		const sidebar = document.createElement("aside");
		sidebar.id = "readerSynopsisSidebar";
		sidebar.setAttribute("aria-live", "polite");
		sidebar.setAttribute("aria-label", "Sinopse do livro");
		sidebar.setAttribute("data-immersive-reader-ignore", "true");
		sidebar.innerHTML = `
			<div class="synopsisSidebarHeader" data-immersive-reader-ignore="true">
				<div class="synopsisSidebarTitle">Sinopse</div>
				<button id="synopsisSidebarClose" type="button" aria-label="Fechar sinopse">×</button>
			</div>
			<div id="synopsisSidebarStatus" class="synopsisSidebarStatus" data-immersive-reader-ignore="true">Carregando sinopse...</div>
			<div id="synopsisSidebarBody" class="synopsisSidebarBody" data-immersive-reader-ignore="true"></div>
		`;
		host.appendChild(sidebar);
		this.synopsisSidebarElem = sidebar;
		this.synopsisSidebarBodyElem = sidebar.querySelector("#synopsisSidebarBody");
		this.synopsisSidebarStatusElem = sidebar.querySelector("#synopsisSidebarStatus");
		const closeButton = sidebar.querySelector("#synopsisSidebarClose");
		if (closeButton) {
			closeButton.addEventListener("click", () => this.toggleSynopsisSidebar(false));
		}
		this.updateSynopsisSidebarLayout();
		return sidebar;
	}

	setSynopsisStatus(text = "") {
		if (!this.synopsisSidebarStatusElem) {
			return;
		}
		const normalized = String(text || "").trim();
		this.synopsisSidebarStatusElem.textContent = normalized;
		this.synopsisSidebarStatusElem.style.display = normalized ? "block" : "none";
	}

	renderSynopsisSidebarContent(payload) {
		if (!this.synopsisSidebarBodyElem) {
			return;
		}
		this.synopsisSidebarBodyElem.innerHTML = "";
		const title = String(payload?.title || "").trim();
		const subtitle = String(payload?.subtitle || "").trim();
		const author = String(payload?.author || "").trim().replace(/[;:,]+$/g, "").trim();
		if (title || subtitle || author) {
			const header = document.createElement("div");
			header.className = "synopsisSidebarHeaderBlock";
			if (title) {
				const titleElem = document.createElement("div");
				titleElem.className = "synopsisSidebarBookTitle";
				titleElem.textContent = title;
				header.appendChild(titleElem);
			}
			if (subtitle) {
				const subtitleElem = document.createElement("div");
				subtitleElem.className = "synopsisSidebarBookSubtitle";
				subtitleElem.textContent = subtitle;
				header.appendChild(subtitleElem);
			}
			if (author) {
				const authorElem = document.createElement("div");
				authorElem.className = "synopsisSidebarBookAuthor";
				authorElem.textContent = author;
				header.appendChild(authorElem);
			}
			this.synopsisSidebarBodyElem.appendChild(header);
		}
		const text = String(payload?.text || "").trim();
		if (text) {
			const description = document.createElement("p");
			description.textContent = text;
			this.synopsisSidebarBodyElem.appendChild(description);
		}

		const meta = document.createElement("div");
		meta.className = "synopsisSidebarMeta";
		meta.textContent = `Fonte: ${payload?.source || "Google Books"}`;
		this.synopsisSidebarBodyElem.appendChild(meta);

		const links = document.createElement("div");
		links.className = "synopsisSidebarLinks";
		const addLink = (href, label) => {
			if (!href) return;
			const anchor = document.createElement("a");
			anchor.href = href;
			anchor.target = "_blank";
			anchor.rel = "noopener noreferrer";
			anchor.textContent = label;
			links.appendChild(anchor);
		};
		addLink(payload?.sourceUrl, "Abrir na fonte");
		addLink(payload?.googleSearchUrl, "Google Books");
		addLink(payload?.fictionDbSearchUrl, "FictionDB");
		if (links.childNodes.length > 0) {
			this.synopsisSidebarBodyElem.appendChild(links);
		}
	}

	getSynopsisSearchPayload() {
		const attrs = this.book?.attributes || {};
		const title = String(this.book?.title || "").trim();
		const author = String(attrs.Creator || attrs.creator || "").trim().replace(/[;:,]+$/g, "").trim();
		const identifier = String(attrs.Identifier || attrs.identifier || attrs.ISBN || attrs.isbn || attrs["dc:identifier"] || "").trim();
		const isbn = reader.util.extractIsbn(identifier);
		const query = [title, author].filter(Boolean).join(" ").trim();
		return {
			title,
			author,
			isbn,
			query,
			googleSearchUrl: query ? `https://books.google.com/books?q=${encodeURIComponent(query)}` : "https://books.google.com",
			fictionDbSearchUrl: query ? `https://www.fictiondb.com/search/searchresults.php?query=${encodeURIComponent(query)}` : "https://www.fictiondb.com"
		};
	}

	async fetchGoogleBooksSynopsis(searchPayload) {
		const isbn = String(searchPayload?.isbn || "").trim();
		const query = String(searchPayload?.query || "").trim();
		const candidates = [];
		if (isbn) {
			candidates.push(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=3`);
		}
		if (query) {
			candidates.push(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`);
		}
		for (const endpoint of candidates) {
			const response = await fetch(endpoint, { signal: this.synopsisFetchController?.signal });
			if (!response.ok) {
				continue;
			}
			const payload = await response.json();
			const items = Array.isArray(payload?.items) ? payload.items : [];
			for (const item of items) {
				const volumeInfo = item?.volumeInfo || {};
				const rawDescription = String(volumeInfo.description || item?.searchInfo?.textSnippet || "").trim();
				if (!rawDescription) {
					continue;
				}
				const temp = document.createElement("div");
				temp.innerHTML = rawDescription;
				const text = String(temp.textContent || temp.innerText || "").replace(/\s+/g, " ").trim();
				if (!text) {
					continue;
				}
				const authors = Array.isArray(volumeInfo.authors) ? volumeInfo.authors.join(", ") : "";
				return {
					source: "Google Books",
					title: volumeInfo.title || searchPayload.title,
					subtitle: volumeInfo.subtitle || "",
					author: authors || searchPayload.author,
					text,
					sourceUrl: volumeInfo.infoLink || item?.selfLink || "",
					googleSearchUrl: searchPayload.googleSearchUrl,
					fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
				};
			}
		}
		return null;
	}

	async fetchOpenLibrarySynopsis(searchPayload) {
		const isbn = String(searchPayload?.isbn || "").trim();
		const query = String(searchPayload?.query || "").trim();
		try {
			if (isbn) {
				const endpoint = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
				const response = await fetch(endpoint, { signal: this.synopsisFetchController?.signal });
				if (response.ok) {
					const data = await response.json();
					const entry = data[`ISBN:${isbn}`];
					const raw = entry?.description;
					const text = typeof raw === "string" ? raw : (raw?.value || "");
					const authors = Array.isArray(entry?.authors) ? entry.authors.map(a => a && a.name).filter(Boolean).join(", ") : "";
					if (text) {
						return {
							source: "Open Library",
							title: entry?.title || searchPayload.title,
							subtitle: entry?.subtitle || "",
							author: authors || searchPayload.author,
							text: String(text).replace(/\s+/g, " ").trim(),
							sourceUrl: entry?.url || "",
							googleSearchUrl: searchPayload.googleSearchUrl,
							fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
						};
					}
				}
			}
			if (query) {
				const searchEndpoint = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;
				const searchResponse = await fetch(searchEndpoint, { signal: this.synopsisFetchController?.signal });
				if (searchResponse.ok) {
					const searchPayloadJson = await searchResponse.json();
					const doc = Array.isArray(searchPayloadJson?.docs) ? searchPayloadJson.docs[0] : null;
					const workKey = doc?.key || (doc?.edition_key ? `/works/${doc.edition_key[0]}` : "");
					if (workKey) {
						const workResponse = await fetch(`https://openlibrary.org${workKey}.json`, { signal: this.synopsisFetchController?.signal });
						if (workResponse.ok) {
							const work = await workResponse.json();
							const raw = work?.description;
							const text = typeof raw === "string" ? raw : (raw?.value || "");
							const authors = Array.isArray(work?.authors) ? work.authors.map(a => a?.author?.key).filter(Boolean).join(", ") : "";
							if (text) {
								return {
									source: "Open Library",
									title: work?.title || searchPayload.title,
									subtitle: work?.subtitle || "",
									author: authors || searchPayload.author,
									text: String(text).replace(/\s+/g, " ").trim(),
									sourceUrl: `https://openlibrary.org${workKey}`,
									googleSearchUrl: searchPayload.googleSearchUrl,
									fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
								};
							}
						}
					}
				}
			}
		} catch (_error) {
			return null;
		}
		return null;
	}

	async loadSynopsisSidebarContent() {
		if (this.synopsisFetchCache) {
			this.renderSynopsisSidebarContent(this.synopsisFetchCache);
			this.setSynopsisStatus("");
			return;
		}
		if (this.synopsisFetchController) {
			this.synopsisFetchController.abort();
		}
		const searchPayload = this.getSynopsisSearchPayload();
		if (!searchPayload.query && !searchPayload.isbn) {
			this.renderSynopsisSidebarContent({
				source: "Google Books",
				title: searchPayload.title,
				subtitle: "",
				author: searchPayload.author,
				text: "",
				sourceUrl: "",
				googleSearchUrl: searchPayload.googleSearchUrl,
				fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
			});
			this.setSynopsisStatus("Livro sem metadados suficientes para buscar a sinopse.");
			return;
		}

		this.synopsisFetchController = new AbortController();
		this.setSynopsisStatus("Carregando sinopse...");
		try {
			let synopsis = await this.fetchGoogleBooksSynopsis(searchPayload);
			if (!synopsis) {
				synopsis = await this.fetchOpenLibrarySynopsis(searchPayload);
			}
			this.synopsisFetchCache = synopsis || {
				source: "Google Books",
				title: searchPayload.title,
				subtitle: "",
				author: searchPayload.author,
				text: "",
				sourceUrl: "",
				googleSearchUrl: searchPayload.googleSearchUrl,
				fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
			};
			this.renderSynopsisSidebarContent(this.synopsisFetchCache);
			this.setSynopsisStatus(synopsis ? "" : "Sinopse não encontrada automaticamente. Use os links abaixo.");
		} catch (error) {
			if (error && error.name === "AbortError") {
				return;
			}
			this.synopsisFetchCache = {
				source: "Google Books",
				title: searchPayload.title,
				subtitle: "",
				author: searchPayload.author,
				text: "",
				sourceUrl: "",
				googleSearchUrl: searchPayload.googleSearchUrl,
				fictionDbSearchUrl: searchPayload.fictionDbSearchUrl
			};
			this.renderSynopsisSidebarContent(this.synopsisFetchCache);
			this.setSynopsisStatus("Falha ao carregar sinopse agora. Tente novamente.");
		} finally {
			this.synopsisFetchController = null;
		}
	}

	async toggleSynopsisSidebar(forceOpen = null) {
		const nextVisible = forceOpen == null ? !this.synopsisSidebarVisible : !!forceOpen;
		if (!nextVisible) {
			this.synopsisSidebarVisible = false;
			if (this.synopsisFetchController) {
				this.synopsisFetchController.abort();
				this.synopsisFetchController = null;
			}
			if (this.synopsisSidebarElem) {
				this.synopsisSidebarElem.classList.remove("open");
			}
			return;
		}
		const sidebar = this.ensureSynopsisSidebar();
		if (!sidebar) {
			return;
		}
		this.synopsisSidebarVisible = true;
		this.updateSynopsisSidebarLayout();
		sidebar.classList.add("open");
		await this.loadSynopsisSidebarContent();
	}

	onNavigationKey(event) {
		if (event.key === "F3") {
			event.preventDefault();
			event.stopPropagation();
			const searchBox = reader.util.loadElem("#readerSearchBox");
			if (searchBox && !searchBox.classList.contains("open")) {
				this.openReaderSearch();
			}
			if (this.searchOrderedResults.length) {
				this.navigateMatch(event.shiftKey ? -1 : 1);
			} else {
				this.runSearch();
			}
			return;
		}

		const target = event.target;
		if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
			return;
		}
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		const key = event.key.toLowerCase();
		if (key === "b") {
			event.preventDefault();
			event.stopPropagation();
			this.goToBeginning();
			return;
		}
		if (key === "e") {
			event.preventDefault();
			event.stopPropagation();
			this.goToEnd();
			return;
		}
		if (key === "d") {
			event.preventDefault();
			event.stopPropagation();
			this.goToPrevChapter();
			return;
		}
		if (key === "k") {
			event.preventDefault();
			event.stopPropagation();
			this.goToNextChapter();
			return;
		}
		if (key === "x") {
			event.preventDefault();
			event.stopPropagation();
			this.openReaderSearch();
			return;
		}
		if (key === "i") {
			event.preventDefault();
			event.stopPropagation();
			void this.toggleSynopsisSidebar();
			return;
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			this.prevPage();
			return;
		}
		if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") {
			event.preventDefault();
			event.stopPropagation();
			this.nextPage();
		}
	}

	startAutoPageAdvance() {
		// No-op: single pageContainer (working content) does not use linear/sync auto-advance
	}

	stopAutoPageAdvance() {
		if (!this.autoPageAdvanceHandler) {
			return;
		}
		document.removeEventListener("selectionchange", this.autoPageAdvanceHandler);
		this.autoPageAdvanceHandler = null;
		if (this.autoPageAdvanceTimer) {
			window.clearInterval(this.autoPageAdvanceTimer);
			this.autoPageAdvanceTimer = null;
		}
	}

	startLinearSync() {
		this.stopLinearSync();
	}

	stopLinearSync() {
		if (!this.linearSyncTimer) {
			return;
		}
		window.clearInterval(this.linearSyncTimer);
		this.linearSyncTimer = null;
		this.linearSyncBusy = false;
	}

	syncPageToLinearSelection() {
		// No-op: single pageContainer (working content) has no separate linear view
	}

	syncLinearSelectionToPageStart() {
		// No-op: single pageContainer (working content)
	}

	async syncPageWithImmersiveSelection() {
		const selection = window.getSelection && window.getSelection();
		if (!selection || !selection.rangeCount) {
			return;
		}
		await this.syncPageToSelectionViewport(selection);
	}

	syncSelectionAnchorToPage(selection) {
		if (!selection || !selection.rangeCount || !this.pageContent) {
			return null;
		}
		const anchorElem = this.getSelectionAnchorElement(selection);
		if (!anchorElem) {
			return null;
		}
		let anchorSourceRoot = this.pageContent;
		if (!anchorSourceRoot.contains(anchorElem)) {
			const clonePageContent = this.spreadClone?.querySelector?.("#pageContent")
				|| document.querySelector("#readerSpreadClone #pageContent");
			if (clonePageContent && clonePageContent.contains(anchorElem)) {
				anchorSourceRoot = clonePageContent;
			} else {
				const linearRoot = reader.util.loadElem("#readerLinear");
				if (!linearRoot || !linearRoot.contains(anchorElem)) {
					return null;
				}
				anchorSourceRoot = linearRoot;
			}
		}
		const sourceStableAnchors = this.getStableAnchorElements(anchorSourceRoot);
		let sourceStableIndex = sourceStableAnchors.findIndex(elem => elem === anchorElem || elem.contains(anchorElem));
		if (sourceStableIndex < 0) {
			sourceStableIndex = sourceStableAnchors.findIndex(elem => anchorElem.contains(elem));
		}
		if (sourceStableIndex < 0) {
			return null;
		}
		const liveStableAnchors = this.getStableAnchorElements(this.pageContent);
		const mappedStableElem = liveStableAnchors[Math.max(0, Math.min(sourceStableIndex, liveStableAnchors.length - 1))];
		if (!mappedStableElem) {
			return null;
		}
		const anchors = this.getAnchorElements();
		const anchorIndex = anchors.findIndex(elem => elem === mappedStableElem || elem.contains(mappedStableElem) || mappedStableElem.contains(elem));
		if (anchorIndex < 0) {
			return null;
		}
		return {
			anchorElem,
			anchorIndex,
			anchorSourceRoot,
			sourceStableIndex
		};
	}

	mirrorSpreadSelectionToLinear(anchorNode, anchorElem, selection) {
		// No-op: single pageContainer (working content)
	}

	enterImmersiveMode() {
		if (!this.allowDetachedImmersiveMode) {
			return;
		}
		if (this.spreadDetached) {
			return;
		}
		if (this.pageNumberItems && this.pageNumberItems.length) {
			this.pageNumberItems.forEach(item => item.hide());
		}
		this.lastImmersiveCloneStableIndex = null;
		this.lastSelectionSyncSignature = "";
		this.lastSelectionSyncAt = 0;
		this.lastImmersiveAdvancePage = -1;
		this.lastImmersiveAdvanceAt = 0;
		const spread = this.spreadElem;
		if (!spread || !this.container) {
			return;
		}
		if (!this.spreadPlaceholder) {
			this.spreadPlaceholder = document.createElement("div");
			this.spreadPlaceholder.style.display = "none";
		}
		if (!this.spreadClone) {
			this.spreadClone = spread.cloneNode(true);
			this.spreadClone.id = "readerSpreadClone";
		}
		spread.parentElement?.insertBefore(this.spreadPlaceholder, spread);
		spread.parentElement?.insertBefore(this.spreadClone, spread);
		spread.remove();
		this.spreadDetached = true;
	}

	exitImmersiveMode() {
		if (!this.spreadDetached) {
			return;
		}
		this.lastImmersiveCloneStableIndex = null;
		this.lastSelectionSyncSignature = "";
		this.lastSelectionSyncAt = 0;
		this.lastImmersiveAdvancePage = -1;
		this.lastImmersiveAdvanceAt = 0;
		if (!this.spreadPlaceholder || !this.spreadElem) {
			return;
		}
		if (this.container.querySelector("#readerSpread")) {
			this.spreadDetached = false;
			this.updatePageNumbers();
			return;
		}
		if (this.spreadClone) {
			this.spreadClone.remove();
			this.spreadClone = null;
		}
		this.spreadPlaceholder.replaceWith(this.spreadElem);
		this.spreadDetached = false;
		this.updatePageNumbers();
	}

	clearImmersiveWordMarker() {
		if (!this.pageContent) return;
		this.pageContent.querySelectorAll("mark.immersive-last-word").forEach(mark => {
			const text = document.createTextNode(mark.textContent || "");
			mark.replaceWith(text);
		});
	}

	isWordCharacter(char) {
		return /[\p{L}\p{N}_'-]/u.test(char || "");
	}

	normalizeWord(word) {
		return String(word || "")
			.toLowerCase()
			.replace(/(^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$)/gu, "");
	}

	getWordAtTextPosition(text, rawIndex) {
		if (!text || !text.length) return null;
		let idx = Math.max(0, Math.min(rawIndex, text.length - 1));
		if (!this.isWordCharacter(text[idx]) && idx > 0 && this.isWordCharacter(text[idx - 1])) {
			idx -= 1;
		}
		if (!this.isWordCharacter(text[idx])) return null;
		let start = idx;
		let end = idx + 1;
		while (start > 0 && this.isWordCharacter(text[start - 1])) start -= 1;
		while (end < text.length && this.isWordCharacter(text[end])) end += 1;
		const word = text.slice(start, end);
		if (!this.normalizeWord(word)) return null;
		return { word, start, end };
	}

	getWordOccurrenceIndex(text, normalizedWord, absoluteCharIndex) {
		if (!text || !normalizedWord) return 0;
		let count = 0;
		let i = 0;
		while (i < text.length) {
			if (!this.isWordCharacter(text[i])) {
				i++;
				continue;
			}
			let j = i + 1;
			while (j < text.length && this.isWordCharacter(text[j])) j++;
			const token = text.slice(i, j);
			if (this.normalizeWord(token) === normalizedWord) {
				if (absoluteCharIndex >= i && absoluteCharIndex <= j) {
					return count;
				}
				count++;
			}
			i = j;
		}
		return Math.max(0, count - 1);
	}

	resolveSelectionTextPoint(selection) {
		if (!selection || !selection.rangeCount) return null;
		const range = selection.getRangeAt(0);
		let anchorNode = selection.focusNode || range.endContainer;
		let anchorOffset = typeof selection.focusOffset === "number" ? selection.focusOffset : range.endOffset;
		if (!anchorNode) return null;

		if (anchorNode.nodeType !== Node.TEXT_NODE) {
			let textNode = null;
			if (anchorNode.childNodes && anchorNode.childNodes.length) {
				const idx = Math.max(0, Math.min((anchorOffset || 1) - 1, anchorNode.childNodes.length - 1));
				const child = anchorNode.childNodes[idx];
				if (child) {
					if (child.nodeType === Node.TEXT_NODE) {
						textNode = child;
						anchorOffset = (child.nodeValue || "").length;
					} else {
						const childWalker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
						let last = null;
						let next = childWalker.nextNode();
						while (next) {
							last = next;
							next = childWalker.nextNode();
						}
						textNode = last;
						if (textNode) {
							anchorOffset = (textNode.nodeValue || "").length;
						}
					}
				}
			}
			if (!textNode) {
				const walker = document.createTreeWalker(anchorNode, NodeFilter.SHOW_TEXT, null);
				textNode = walker.nextNode();
			}
			if (!textNode) return null;
			anchorNode = textNode;
			anchorOffset = Math.min(anchorOffset || 0, (anchorNode.nodeValue || "").length);
		}

		return {
			node: anchorNode,
			offset: Math.max(0, Number(anchorOffset) || 0)
		};
	}

	getSelectionWordToken(selection, anchorElem = null) {
		const point = this.resolveSelectionTextPoint(selection);
		if (!point || !point.node) return null;
		const parentElem = point.node.parentElement;
		if (!parentElem) return null;
		const scope = anchorElem || parentElem.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div");
		if (!scope || !scope.contains(parentElem)) return null;
		const index = this.getTextIndexForScope(scope);
		const absoluteIndex = this.getAbsoluteOffsetInScope(scope, point.node, point.offset);
		if (!index || absoluteIndex == null) return null;
		const entry = this.getWordEntryAtOffset(index, Math.max(0, absoluteIndex - 1));
		if (!entry || !entry.normalizedWord) return null;
		return {
			normalizedWord: entry.normalizedWord,
			wordOccurrence: entry.wordOccurrence,
			start: entry.start,
			end: entry.end
		};
	}

	getTtsPageFlowOffsetPx() {
		const contentWidth = this.getSpreadContentWidth();
		if (contentWidth <= 0) return 0;
		return contentWidth * Renderer.TTS_PAGE_FLOW_OFFSET_RATIO;
	}

	getSpreadPageFromRect(rect, rootElem = null, flowOffsetPx = 0) {
		if (!rect || !this.spreadElem) return null;
		const contentRoot = rootElem || this.pageContent;
		if (!contentRoot) return null;
		const contentRect = contentRoot.getBoundingClientRect();
		const contentWidth = this.getSpreadContentWidth();
		const gap = this.getColumnGap();
		const step = contentWidth + gap;
		if (step <= 0) return null;
		const colCount = this.getColumnCount();
		const centerX = (Number(rect.left) + Number(rect.right)) / 2 + (Number(flowOffsetPx) || 0);
		const xInContent = Math.max(0, centerX - contentRect.left);
		const spreadIndex = Math.max(0, Math.floor(xInContent / step));
		return spreadIndex * colCount;
	}

	getSpreadPageFromCloneWordToken(selection, sourceStableIndex, sourceAnchorElem = null) {
		if (!selection || sourceStableIndex < 0) return null;
		const clonePageContent = this.spreadClone?.querySelector?.("#pageContent")
			|| document.querySelector("#readerSpreadClone #pageContent");
		if (!clonePageContent) return null;
		const token = this.getSelectionWordToken(selection, sourceAnchorElem || undefined);
		if (!token) return null;
		const cloneStableAnchors = this.getStableAnchorElements(clonePageContent);
		const mappedCloneElem = cloneStableAnchors[Math.max(0, Math.min(sourceStableIndex, cloneStableAnchors.length - 1))];
		if (!mappedCloneElem) return null;
		const range = this.findWordRangeInAnchor(mappedCloneElem, token.normalizedWord, token.wordOccurrence);
		if (!range) return null;
		const rect = range.getBoundingClientRect();
		if (!rect || (!rect.width && !rect.height)) return null;
		return this.getSpreadPageFromRect(rect, clonePageContent, this.getTtsPageFlowOffsetPx());
	}

	getSpreadPageFromLiveWordToken(selection, sourceStableIndex, sourceAnchorElem = null) {
		if (!selection || sourceStableIndex < 0 || !this.pageContent) return null;
		const token = this.getSelectionWordToken(selection, sourceAnchorElem || undefined);
		if (!token) return null;
		const liveStableAnchors = this.getStableAnchorElements(this.pageContent);
		const mappedLiveElem = liveStableAnchors[Math.max(0, Math.min(sourceStableIndex, liveStableAnchors.length - 1))];
		if (!mappedLiveElem) return null;
		const range = this.findWordRangeInAnchor(mappedLiveElem, token.normalizedWord, token.wordOccurrence);
		if (!range) return null;
		const rect = range.getBoundingClientRect();
		if (!rect || (!rect.width && !rect.height)) return null;
		return this.getSpreadPageFromRect(rect, this.pageContent, this.getTtsPageFlowOffsetPx());
	}

	async persistReadingState(forceImmediate = false) {
		if (!this.book || !this.pageContent) return;
		this.position.anchor = this.getAnchor();
		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		this.position.chapter = ch;
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		await this.savePositionState(ch, Math.max(0, ach), percentage, forceImmediate);
	}

	scheduleReadingStatePersist() {
		window.clearTimeout(this.readingStateSaveTimeout);
		window.clearTimeout(this.positionPersistTimeout);
		this.readingStateSaveTimeout = window.setTimeout(() => {
			this.persistReadingState();
		}, 120);
	}

	startSelectionCapture() {
		return;
	}

	stopSelectionCapture() {
		if (!this.selectionCaptureTimer) return;
		window.clearInterval(this.selectionCaptureTimer);
		this.selectionCaptureTimer = null;
	}

	getSelectionWordSnapshot(selection) {
		if (!selection || !selection.rangeCount || !this.pageContent) return null;
		const range = selection.getRangeAt(0);
		let anchorNode = selection.focusNode || range.endContainer;
		let anchorOffset = typeof selection.focusOffset === "number" ? selection.focusOffset : range.endOffset;
		if (!anchorNode) return null;

		if (anchorNode.nodeType !== Node.TEXT_NODE) {
			let textNode = null;
			if (anchorNode.childNodes && anchorNode.childNodes.length) {
				const idx = Math.max(0, Math.min((anchorOffset || 1) - 1, anchorNode.childNodes.length - 1));
				const child = anchorNode.childNodes[idx];
				if (child) {
					if (child.nodeType === Node.TEXT_NODE) {
						textNode = child;
						anchorOffset = (child.nodeValue || "").length;
					} else {
						const childWalker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
						let last = null;
						let next = childWalker.nextNode();
						while (next) {
							last = next;
							next = childWalker.nextNode();
						}
						textNode = last;
						if (textNode) {
							anchorOffset = (textNode.nodeValue || "").length;
						}
					}
				}
			}
			if (!textNode) {
				const walker = document.createTreeWalker(anchorNode, NodeFilter.SHOW_TEXT, null);
				textNode = walker.nextNode();
			}
			if (!textNode) return null;
			anchorNode = textNode;
			anchorOffset = Math.min(anchorOffset || 0, (anchorNode.nodeValue || "").length);
		}

		const parentElem = anchorNode.parentElement;
		if (!parentElem || !this.pageContent.contains(parentElem)) return null;
		const anchors = this.getAnchorElements();
		const anchorElem = parentElem.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div");
		if (!anchorElem || !this.pageContent.contains(anchorElem)) return null;
		const globalAnchorIndex = anchors.findIndex(elem => elem === anchorElem || elem.contains(anchorElem));
		if (globalAnchorIndex < 0) return null;
		const index = this.getTextIndexForScope(anchorElem);
		const absoluteIndex = this.getAbsoluteOffsetInScope(anchorElem, anchorNode, anchorOffset);
		if (!index || absoluteIndex == null) return null;
		const entry = this.getWordEntryAtOffset(index, Math.max(0, absoluteIndex - 1));
		if (!entry || !entry.normalizedWord) return null;
		const chapterAnchor = this.getCurrentChapterAndAnchor(globalAnchorIndex);
		return {
			word: entry.word,
			normalizedWord: entry.normalizedWord,
			wordOccurrence: entry.wordOccurrence,
			charOffset: entry.start,
			chapter: chapterAnchor.chapter,
			anchor: chapterAnchor.anchor,
			page: this.page,
			updatedAt: Date.now()
		};
	}

	scheduleImmersiveWordSave(snapshot) {
		return;
		if (!snapshot || !snapshot.normalizedWord) return;
		this.savedImmersiveWord = snapshot;
		const key = `${snapshot.chapter}:${snapshot.anchor}:${snapshot.wordOccurrence}:${snapshot.normalizedWord}`;
		if (key === this.lastImmersiveWordKey) return;
		this.lastImmersiveWordKey = key;
		window.clearTimeout(this.immersiveWordSaveTimeout);
		this.immersiveWordSaveTimeout = window.setTimeout(() => {
			reader.store.setImmersiveLastWord(this.book, this.savedImmersiveWord);
		}, 120);
	}

	saveImmersiveWordFromCurrentSelection(force = false) {
		return;
		const selection = window.getSelection && window.getSelection();
		const snapshot = this.getSelectionWordSnapshot(selection);
		if (!snapshot) {
			if (force && this.savedImmersiveWord) {
				window.clearTimeout(this.immersiveWordSaveTimeout);
				reader.store.setImmersiveLastWord(this.book, this.savedImmersiveWord);
			}
			return;
		}
		if (force) {
			window.clearTimeout(this.immersiveWordSaveTimeout);
			reader.store.setImmersiveLastWord(this.book, snapshot);
			this.savedImmersiveWord = snapshot;
			this.lastImmersiveWordKey = `${snapshot.chapter}:${snapshot.anchor}:${snapshot.wordOccurrence}:${snapshot.normalizedWord}`;
			return;
		}
		this.scheduleImmersiveWordSave(snapshot);
	}

	findWordRangeInAnchor(anchorElem, normalizedWord, wordOccurrence) {
		if (!anchorElem || !normalizedWord) return null;
		const index = this.getTextIndexForScope(anchorElem);
		if (!index) return null;
		const entry = index.words.find(word => word.normalizedWord === normalizedWord && word.wordOccurrence === wordOccurrence);
		if (!entry) return null;
		return this.getRangeFromAbsoluteOffsets(anchorElem, entry.start, entry.end);
	}

	getRangeFromAbsoluteOffsets(anchorElem, startOffset, endOffset) {
		if (!anchorElem) return null;
		const index = this.getTextIndexForScope(anchorElem);
		if (!index || !index.textNodes.length) return null;
		let startNode = null;
		let endNode = null;
		let startInNode = 0;
		let endInNode = 0;
		for (const entry of index.textNodes) {
			if (!startNode && startOffset >= entry.start && startOffset <= entry.end) {
				startNode = entry.node;
				startInNode = Math.max(0, Math.min((entry.node.nodeValue || "").length, startOffset - entry.start));
			}
			if (!endNode && endOffset >= entry.start && endOffset <= entry.end) {
				endNode = entry.node;
				endInNode = Math.max(0, Math.min((entry.node.nodeValue || "").length, endOffset - entry.start));
			}
			if (startNode && endNode) break;
		}
		if (!startNode || !endNode) return null;
		const range = document.createRange();
		range.setStart(startNode, startInNode);
		range.setEnd(endNode, endInNode);
		return range;
	}

	restoreSavedImmersiveWordHighlight() {
		return;
		this.clearImmersiveWordMarker();
		const snapshot = this.savedImmersiveWord;
		if (!snapshot || !snapshot.normalizedWord || !this.pageContent) return;
		const globalAnchor = this.getGlobalAnchorIndex(snapshot.chapter || 0, snapshot.anchor || 0);
		const anchors = this.getAnchorElements();
		const anchorElem = anchors[globalAnchor];
		if (!anchorElem) return;
		let range = null;
		const text = anchorElem.textContent || "";
		if (Number.isFinite(Number(snapshot.charOffset)) && text.length) {
			const segment = this.getWordAtTextPosition(text, Math.max(0, Number(snapshot.charOffset)));
			if (segment && this.normalizeWord(segment.word) === snapshot.normalizedWord) {
				range = this.getRangeFromAbsoluteOffsets(anchorElem, segment.start, segment.end);
			}
		}
		if (!range) {
			range = this.findWordRangeInAnchor(anchorElem, snapshot.normalizedWord, Math.max(0, snapshot.wordOccurrence || 0));
		}
		if (!range) return;
		const mark = document.createElement("mark");
		mark.className = "immersive-last-word";
		try {
			range.surroundContents(mark);
		} catch (_err) {
			const text = range.toString();
			if (!text) return;
			range.deleteContents();
			mark.textContent = text;
			range.insertNode(mark);
		}
	}

	clearSpreadHighlights() {
		const containers = this.getVisibleSpreadContainers();
		if (!containers.length) {
			return;
		}
		containers.forEach(container => {
			if (!container) return;
			container.querySelectorAll('mark.tts-highlight[data-coentro-wrap="1"]').forEach(mark => {
				const parent = mark.parentNode;
				while (mark.firstChild) {
					parent.insertBefore(mark.firstChild, mark);
				}
				mark.remove();
			});
		});
	}

	getParagraphOffset(paragraph, node, offset) {
		const absolute = this.getAbsoluteOffsetInScope(paragraph, node, offset);
		return absolute == null ? 0 : absolute;
	}

	findNodeAtOffset(paragraph, offset) {
		const index = this.getTextIndexForScope(paragraph);
		if (!index) return null;
		for (const entry of index.textNodes) {
			if (offset >= entry.start && offset <= entry.end) {
				return { node: entry.node, offset: Math.max(0, offset - entry.start) };
			}
		}
		return null;
	}

	mirrorLinearSelectionHighlight() {
		// No-op: single pageContainer (working content) has no separate linear view to mirror
	}

	getVisibleSpreadContainers() {
		return [this.pageContent, null];
	}

	getLastTextNode(root) {
		if (!root) return null;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		let last = null;
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node && node.nodeValue && node.nodeValue.trim()) {
				last = node;
			}
		}
		return last;
	}

	queueNavClick(direction) {
		if (direction !== "next" && direction !== "prev") return;
		this.showNavToast(direction === "next" ? "right" : "left");
		this.navQueue.push(direction);
		void this.flushNavQueue();
	}

	getNavToastBaseStep() {
		if (this.pageViewMode === "two") return 2;
		if (this.pageViewMode === "three") return 3;
		if (this.pageViewMode === "four") return 4;
		return 1;
	}

	ensureNavToast(side) {
		const host = reader.util.loadElem(side === "left" ? "#readerNavLeft" : "#readerNavRight");
		if (!host) return null;
		let toast = host.querySelector(".readerNavToast");
		if (!toast) {
			toast = reader.util.createElement("div", host, "readerNavToast");
			toast.setAttribute("aria-hidden", "true");
		}
		return toast;
	}

	showNavToast(side) {
		const toast = this.ensureNavToast(side);
		if (!toast) return;
		const key = side === "left" ? "left" : "right";
		const sign = key === "left" ? "-" : "+";
		const base = this.getNavToastBaseStep();
		const nextCount = (Number(this.navToastCounts[key]) || 0) + 1;
		this.navToastCounts[key] = nextCount;
		toast.textContent = `${sign}${base * nextCount}`;
		toast.classList.remove("active");
		void toast.offsetWidth;
		toast.classList.add("active");
		if (this.navToastTimers[key]) {
			window.clearTimeout(this.navToastTimers[key]);
		}
		this.navToastTimers[key] = window.setTimeout(() => {
			toast.classList.remove("active");
			this.navToastCounts[key] = 0;
		}, 3000);
	}

	async flushNavQueue() {
		if (this.navQueueActive) return;
		this.navQueueActive = true;
		try {
			while (this.navQueue.length) {
				const direction = this.navQueue.shift();
				if (direction === "next") {
					await this.nextPage();
				} else {
					await this.prevPage();
				}
				if (this.loading) {
					this.navQueue.length = 0;
					break;
				}
			}
		} finally {
			this.navQueueActive = false;
		}
	}

	async prevPage() {
		if (this.loading) return;
		this.manualNavLockUntil = Date.now() + 3000;
		this.flashNavEdge("left");
		const maxPage = await this.getMaxPage();
		if (maxPage <= 0) {
			if (this.position.chapter > 0) {
				await this.goToChapter(this.position.chapter - 1, 0);
			}
			return;
		}
		if (this.page <= 0) return;
		const previousAnchor = this.lastTrackedAnchor;
		const previousChapter = this.position.chapter;
		const step = this.getNavigationStep("prev");
		this.page -= step;
		this.applyPageOffset();
		this.position.anchor = this.getAnchor();
		this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		await this.onResize();
		if (this.position.chapter === previousChapter && previousAnchor > this.position.anchor) {
			const prev = this.getCurrentChapterAndAnchor(previousAnchor);
			const curr = this.getCurrentChapterAndAnchor(this.position.anchor);
			if (prev.chapter === curr.chapter) {
				const wordsRead = this.countWordsBetweenAnchors(this.position.chapter, curr.anchor, prev.anchor);
				if (wordsRead > 0) await reader.store.addWordsRead(wordsRead);
			}
		}
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		this.savePositionState(ch, ach, percentage);
	}

	async nextPage() {
		if (this.loading) return;
		this.manualNavLockUntil = Date.now() + 3000;
		this.flashNavEdge("right");
		const colCount = this.getNavigationStep("next");
		const maxPage = await this.getMaxPage();
		if (maxPage <= 0) {
			if (this.position.chapter < this.book.contents.length - 1) {
				await this.goToChapter(this.position.chapter + 1, 0);
			} else {
				await this.updateCompletionStatus();
			}
			return;
		}
		if (this.page >= maxPage) {
			await this.updateCompletionStatus();
			return;
		}
		const previousAnchor = this.lastTrackedAnchor;
		const previousChapter = this.position.chapter;
		this.page += colCount;
		this.applyPageOffset();
		this.position.anchor = this.getAnchor();
		this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		await this.onResize();
		if (this.position.chapter === previousChapter && this.position.anchor > previousAnchor) {
			const prev = this.getCurrentChapterAndAnchor(previousAnchor);
			const curr = this.getCurrentChapterAndAnchor(this.position.anchor);
			if (prev.chapter === curr.chapter) {
				const wordsRead = this.countWordsBetweenAnchors(this.position.chapter, prev.anchor, curr.anchor);
				if (wordsRead > 0) await reader.store.addWordsRead(wordsRead);
			}
		}
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		this.lastPageTime = new Date().getTime();
		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		this.savePositionState(ch, ach, percentage);
	}

	async goToBeginning() {
		window.clearTimeout(this.positionSaveTimeout);
		this.loading = false;
		this.position.chapter = 0;
		this.position.anchor = 0;
		this.page = 0;
		this.applyPageOffset();
		await this.onResize(true);
		await reader.store.setPosition(this.book, 0, 0, 0, 0, 0, 0, 0);
		await reader.store.setBookStatus(this.book.title, "reading");
		const endCard = reader.util.loadElem("#goodreadsEndCard");
		if (endCard) {
			endCard.classList.remove("visible");
		}
		this.lastTrackedAnchor = 0;
		this.lastTrackedChapter = 0;
	}

	async goToPrevChapter() {
		if (this.loading) return;
		const target = Math.max(0, this.position.chapter - 1);
		if (target === this.position.chapter) return;
		await this.goToChapter(target, 0);
	}

	async goToNextChapter() {
		if (this.loading) return;
		const maxChapter = Math.max(0, this.book.contents.length - 1);
		const target = Math.min(maxChapter, this.position.chapter + 1);
		if (target === this.position.chapter) return;
		await this.goToChapter(target, 0);
	}

	async goToEnd() {
		window.clearTimeout(this.positionSaveTimeout);
		this.loading = false;
		this.page = Math.max(0, await this.getMaxPage());
		this.applyPageOffset();
		await this.onResize(true);
		this.position.anchor = this.getAnchor();
		const { chapter: ch, anchor: ach } = this.getCurrentChapterAndAnchor();
		this.position.chapter = ch;
		const percentage = reader.util.getReadPercentage(this.book.contents, ch, ach);
		this.savePositionState(ch, ach, percentage);
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		const lastChapter = Math.max(0, (this.book?.contents?.length || 1) - 1);
		await reader.store.setPosition(this.book, lastChapter, 999999, 100, this.page, this.position.anchor, this.getChapterStartGlobalAnchor(lastChapter), 100);
		await reader.store.setBookStatus(this.book.title, "read");
		await this.updateCompletionStatus();
	}

	async isAtEndOfChapter() {
		return this.page >= await this.getMaxPage();
	}

	async isAtEndOfBook() {
		return this.position.chapter >= this.book.contents.length - 1 && (await this.isAtEndOfChapter());
	}

	playCompletionReorderSound() {
		try {
			const currentTitle = String(this.book?.title || "").trim();
			if (!currentTitle || window.__coentroLastCompletionSoundTitle === currentTitle) {
				return;
			}
			window.__coentroLastCompletionSoundTitle = currentTitle;
			if (reader?.interface && typeof reader.interface.playLastPlaceSound === "function") {
				void reader.interface.playLastPlaceSound();
				return;
			}
			const audio = new Audio("assets/sad-trumpet.mp3");
			audio.volume = 0.9;
			void audio.play();
		} catch (_error) {}
	}

	async updateCompletionStatus() {
		if (!this.book || !this.pageContent) {
			return;
		}
		if (await this.isAtEndOfBook()) {
			await reader.store.setBookStatus(this.book.title, "read");
			// Move completed book to last position in library
			await reader.store.moveBookToEnd(this.book.title);
			this.playCompletionReorderSound();
			const endCard = reader.util.loadElem("#goodreadsEndCard");
			if (endCard) {
				endCard.classList.add("visible");
			}
			return;
		}
		if (window.__coentroLastCompletionSoundTitle === String(this.book?.title || "").trim()) {
			window.__coentroLastCompletionSoundTitle = "";
		}
		const endCard = reader.util.loadElem("#goodreadsEndCard");
		if (endCard) {
			endCard.classList.remove("visible");
		}
	}

	setupGoodreadsEndCard() {
		const button = reader.util.loadElem("#goodreadsEndButton");
		if (!button) {
			return;
		}
		button.addEventListener("click", event => {
			event.stopPropagation();
			window.open(reader.util.getGoodreadsUrl(this.book), "_blank");
		});
	}


	onMouseMove(event) {
		this.onUserActivity();
		reader.util.loadElem("#readerOverlayTop").applyStyles({ "opacity": 1 });
		reader.util.loadElem("#readerOverlayBottom").applyStyles({ "opacity": 1 });
		this.showColumnMarkers();

		if (this.showNavArrows) {
			this.showNavEdge("left");
			this.showNavEdge("right");
			this.scheduleHideNavEdges();
		}

		window.clearTimeout(this.overlayTimeout);
		this.overlayTimeout = window.setTimeout(() => {
			if (document.body.classList.contains("reader-search-open")) {
				return;
			}
			reader.util.loadElem("#readerOverlayTop").applyStyles({ "opacity": 0 });
			reader.util.loadElem("#readerOverlayBottom").applyStyles({ "opacity": 0 });
		}, 1500);
	}

	overlayProgressMouseMove(event) {
		const tooltip = reader.util.loadElem("#overlayTooltip");
		const { offsetX, clientX } = event;
		if (Math.abs(offsetX) < 5) {
			return;
		}
		const percentage = offsetX / reader.util.loadElem("#overlayProgress").clientWidth * 100;
		const chapters = this.book.chapterPoints.filter(p => percentage >= p.point);
		const chapter = chapters[chapters.length - 1];

		const title = chapter.title ? reader.util.capText(chapter.title, 35) : "CapÃƒÂ­tulo sem tÃƒÂ­tulo";
		tooltip.innerHTML = title;
		tooltip.applyStyles({
			"opacity": 1,
			"left": `${clientX - tooltip.clientWidth / 2}px`
		});

		window.clearTimeout(this.tooltipTimeout);
		this.tooltipTimeout = window.setTimeout(() => {
			tooltip.applyStyles({ "opacity": 0 });
		}, 1000);
	}

	overlayProgressClick(event) {
		if (Math.abs(event.offsetX) < 5) return;
		const percentage = event.offsetX / reader.util.loadElem("#overlayProgress").clientWidth * 100;
		for (let i = this.book.chapterPoints.length - 1; i > -1; i--) {
			if (percentage > this.book.chapterPoints[i].point) {
				this.goToChapter(i, 0);
				return;
			}
		}
	}

	/** Largura total do conteÃƒÂºdo para paginaÃƒÂ§ÃƒÂ£o (scrollWidth do pageContent ou largura aplicada como fallback). */
	getPageContainerScrollWidth() {
		if (!this.pageContent || !this.spreadElem) return 0;
		let w = this.pageContent.scrollWidth || 0;
		const contentWidth = this.getSpreadContentWidth();
		const applied = this.pageContent.style.width ? parseFloat(this.pageContent.style.width) : 0;
		if (w <= contentWidth && applied > contentWidth) w = applied;
		return w;
	}

	getColumnGap() {
		return 100;
	}

	flushCSS(elem) {
		elem.offsetHeight;
	}

	onUserActivity() {
		this.lastActivity = new Date().getTime();
	}

	onUserInteraction() {
		this.lastActivity = new Date().getTime();
		this.userInteractionLockUntil = Date.now() + 2000;
		this.disableHighlightUntil = Date.now() + 2000;
		this.immersiveActiveUntil = 0;
		this.exitImmersiveMode();
	}

	onSelectionChange() {
		const selection = window.getSelection && window.getSelection();
		if (!selection || !selection.rangeCount) {
			return;
		}
		const now = Date.now();
		if (now < (Number(this.manualNavLockUntil) || 0) || now < (Number(this.userInteractionLockUntil) || 0)) {
			return;
		}
		this.immersiveActiveUntil = now + 64;
		if (!this.immersiveSelectionSyncPending) {
			this.immersiveSelectionSyncPending = true;
			Promise.resolve().then(async () => {
				this.immersiveSelectionSyncPending = false;
				await this.syncPageWithImmersiveSelection();
				this.updatePageNumbers();
			});
		}
		this.queueImmersivePageSync("selection");
	}

	async syncPageToSelectionViewport(selection) {
		if (!selection || !selection.rangeCount) {
			return;
		}
		if (!this.pageContent || !this.spreadElem || this.loading) {
			return;
		}
		const now = Date.now();
		if (now < (Number(this.manualNavLockUntil) || 0) || now < (Number(this.userInteractionLockUntil) || 0)) {
			return;
		}
		if (Date.now() < (Number(this.fullscreenTransitionLockUntil) || 0)) {
			return;
		}
		if (now < this.selectionSyncLockUntil) {
			return;
		}
		const seq = ++this.pageSyncSeq;
		const mapped = this.syncSelectionAnchorToPage(selection);
		if (!mapped) {
			return;
		}
		const { anchorElem, anchorIndex, anchorSourceRoot, sourceStableIndex } = mapped;
		const sourceKind = anchorSourceRoot === this.pageContent ? "live" : "clone";
		const immersiveSelection = this.spreadDetached || anchorSourceRoot !== this.pageContent;
		const selectionToken = this.getSelectionWordToken(selection, anchorElem);
		const tokenKey = selectionToken ? `${selectionToken.normalizedWord}:${selectionToken.wordOccurrence}` : "";
		const selectionSignature = `${sourceKind}:${sourceStableIndex}:${tokenKey}`;
		const nowTs = Date.now();
		const dedupeMs = immersiveSelection ? 6 : 80;
		if (selectionSignature === this.lastSelectionSyncSignature && nowTs - this.lastSelectionSyncAt < dedupeMs) {
			this.markSelectionDrivenSync(immersiveSelection);
			return;
		}
		this.lastSelectionSyncSignature = selectionSignature;
		this.lastSelectionSyncAt = nowTs;
		this.markSelectionDrivenSync(immersiveSelection);

		const colCount = this.getColumnCount();
		const liveWordSpreadPage = anchorSourceRoot !== this.pageContent
			? this.getSpreadPageFromLiveWordToken(selection, sourceStableIndex, anchorElem)
			: null;
		let selectionSpreadPage = Number.isFinite(liveWordSpreadPage) && liveWordSpreadPage >= 0
			? liveWordSpreadPage
			: await this.getPageFromAnchor(anchorIndex);
		const cloneWordSpreadPage = this.getSpreadPageFromCloneWordToken(selection, sourceStableIndex, anchorElem);
		if (Number.isFinite(cloneWordSpreadPage) && cloneWordSpreadPage >= 0) {
			selectionSpreadPage = Math.max(selectionSpreadPage, cloneWordSpreadPage);
		}
		const maxPage = await this.getMaxPage();
		let targetPage = Math.min(
			Math.floor(selectionSpreadPage / colCount) * colCount,
			maxPage
		);
		targetPage = this.stabilizeTargetPageAfterObserver(targetPage);
		const maxJump = Math.max(colCount * 2, this.getNavigationStep("next") * 4);
		if (Math.abs(targetPage - this.page) > maxJump) {
			if (targetPage > this.page) {
				// Avoid deadlock when selection mapping lands far ahead in detached immersive mode.
				targetPage = Math.min(maxPage, this.page + colCount);
			} else {
				return;
			}
		}
		if (targetPage === this.lastImmersiveAdvancePage && nowTs - this.lastImmersiveAdvanceAt < 120) {
			return;
		}
		if (seq !== this.pageSyncSeq) {
			return;
		}
		this.page = Math.max(0, Math.min(maxPage, targetPage));
		this.applyPageOffset();
		this.updatePageNumbers();
		this.lastImmersiveAdvancePage = this.page;
		this.lastImmersiveAdvanceAt = nowTs;
		this.position.anchor = this.getAnchor();
		this.position.chapter = this.getCurrentChapterAndAnchor().chapter;
		this.lastTrackedAnchor = this.position.anchor;
		this.lastTrackedChapter = this.position.chapter;
		const current = this.getCurrentChapterAndAnchor();
		const percentage = reader.util.getReadPercentage(this.book.contents, current.chapter, current.anchor);
		this.savePositionState(current.chapter, current.anchor, percentage);
		this.selectionSyncLockUntil = Date.now() + (immersiveSelection ? 0 : 24);
		this.markSelectionDrivenSync(immersiveSelection);
	}

	lockPageTransitions() {
		// Prevent auto page transitions during/after user interaction
		this.userInteractionLockUntil = Date.now() + 2000;
	}

	onVisibilityChange() {
		this.recordReadingTime();
	}

	onFullscreenChange() {
		const lockMs = 1600;
		this.fullscreenTransitionLockUntil = Date.now() + lockMs;
		this.viewportSyncLockUntil = Math.max(this.viewportSyncLockUntil || 0, Date.now() + lockMs);
		this.selectionSyncLockUntil = Math.max(this.selectionSyncLockUntil || 0, Date.now() + lockMs);
		this.immersiveAutoAdvanceLockUntil = Math.max(this.immersiveAutoAdvanceLockUntil || 0, Date.now() + lockMs);
		this.pageSyncSeq += 1;
		window.setTimeout(() => {
			void (async () => {
				if (this.loading) {
					this.fullscreenPageSnapshot = null;
					return;
				}
				const snap = Number(this.fullscreenPageSnapshot);
				const maxPage = Math.max(0, await this.getMaxPage());
				if (Number.isFinite(snap) && snap >= 0) {
					this.page = Math.max(0, Math.min(maxPage, Math.floor(snap)));
				} else {
					this.page = Math.max(0, Math.min(maxPage, Math.floor(this.page || 0)));
				}
		this.applyPageOffset();
				this.updatePageNumbers();
				this.fullscreenPageSnapshot = null;
			})();
		}, 220);
	}

	onBeforeUnload() {
		this.persistReadingState(true);
		this.saveImmersiveWordFromCurrentSelection(true);
		this.recordReadingTime(true);
	}

	startReadingTimer() {
		if (this.readingTimer) {
			return;
		}
		this.readingTimer = window.setInterval(() => {
			this.recordReadingTime();
		}, 30000);
	}

	stopReadingTimer() {
		if (!this.readingTimer) {
			return;
		}
		this.recordReadingTime(true);
		window.clearInterval(this.readingTimer);
		this.readingTimer = null;
	}

	recordReadingTime(force = false) {
		if (!this.book || !this.pageContent) {
			return;
		}
		if (document.hidden) {
			this.lastReadingTick = new Date().getTime();
			return;
		}

		const now = new Date().getTime();
		const idleLimit = 5 * 60 * 1000;
		const idleTooLong = this.lastActivity && now - this.lastActivity > idleLimit;

		if (idleTooLong && !force) {
			this.lastReadingTick = now;
			return;
		}

		if (!this.lastReadingTick) {
			this.lastReadingTick = now;
			return;
		}

		const deltaSeconds = Math.max(0, Math.round((now - this.lastReadingTick) / 1000));
		if (deltaSeconds > 0) {
			reader.store.addReadingTime(deltaSeconds);
		}
		this.lastReadingTick = now;
	}

	showColumnMarkers() {
		if (!this.columnMarkers) {
			return;
		}

		this.columnMarkers.applyStyles({
			"opacity": "1",
			"transition": "opacity 0.3s"
		});

		window.clearTimeout(this.columnMarkersTimeout);
		this.columnMarkersTimeout = window.setTimeout(() => {
			this.hideColumnMarkers();
		}, 5000);
	}

	hideColumnMarkers() {
		if (!this.columnMarkers) {
			return;
		}

		this.columnMarkers.applyStyles({
			"opacity": "0",
			"transition": "opacity 0.6s"
		});
	}

	/** Hide nav arrows after 5s; show again on mousemove. */
	scheduleHideNavEdges() {
		window.clearTimeout(this.navEdgesHideTimeout);
		document.body.classList.remove("reader-nav-hidden");
		this.navEdgesHideTimeout = window.setTimeout(() => {
			document.body.classList.add("reader-nav-hidden");
			this.hideNavEdge("left");
			this.hideNavEdge("right");
			this.navEdgesHideTimeout = null;
		}, this.navAutoHideMs || 5000);
	}

	flashNavEdge(side) {
		if (!this.showNavArrows) return;
		this.showNavEdge(side);
		this.scheduleHideNavEdges();
	}

	showNavEdge(side) {
		if (!this.showNavArrows) return;
		const elem = reader.util.loadElem(side === "left" ? "#readerNavLeft" : "#readerNavRight");
		if (!elem) return;

		window.clearTimeout(this.navHideTimeouts[side]);
		this.navHideTimeouts[side] = null;
		this.navVisible[side] = true;
		elem.classList.add("visible");
		elem.applyStyles({ "opacity": "1", "pointerEvents": "auto" });
		document.body.classList.remove("reader-nav-hidden");
	}

	hideNavEdge(side) {
		const elem = reader.util.loadElem(side === "left" ? "#readerNavLeft" : "#readerNavRight");
		if (!elem) return;

		window.clearTimeout(this.navHideTimeouts[side]);
		this.navHideTimeouts[side] = null;
		this.navVisible[side] = false;
		elem.classList.remove("visible");
		elem.applyStyles({ "opacity": "0", "pointerEvents": "none" });
		if (!this.navVisible.left && !this.navVisible.right) {
			document.body.classList.add("reader-nav-hidden");
		}
	}

	clearNavEdgeTimers() {
		window.clearTimeout(this.navHideTimeouts.left);
		window.clearTimeout(this.navHideTimeouts.right);
		this.navHideTimeouts.left = null;
		this.navHideTimeouts.right = null;
	}

	toggleFullscreen(event) {
		if (event) {
			const target = event.target;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
				return;
			}
			if (event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}
			event.preventDefault();
		}
		this.fullscreenPageSnapshot = this.page;
		this.fullscreenTransitionLockUntil = Date.now() + 1800;

		if (document.fullscreenElement) {
			document.exitFullscreen();
			return;
		}

		if (document.documentElement.requestFullscreen) {
			document.documentElement.requestFullscreen({ navigationUI: "hide" });
		}
	}

	countWordsBetweenAnchors(chapter, start, end) {
		if (start >= end || !this.book?.contents?.[chapter]) return 0;
		const wrap = document.createElement("div");
		wrap.innerHTML = this.book.contents[chapter].innerHTML || "";
		const paragraphs = [...wrap.querySelectorAll("p")];
		if (!paragraphs.length) return 0;
		const safeEnd = Math.min(end, paragraphs.length - 1);
		let total = 0;
		for (let i = start; i <= safeEnd; i++) {
			const text = (paragraphs[i].innerText || "").trim();
			if (!text) {
				continue;
			}
			const words = text.match(/\b[\wÃ¢â‚¬â„¢'-]+\b/g);
			if (words) {
				total += words.length;
			}
		}

		return total;
	}

	queueImmersivePageSync(mode = "auto") {
		this.lastQueuedImmersiveSyncMode = mode || "auto";
		if (this.immersiveSyncFrame) {
			return;
		}
		this.immersiveSyncFrame = window.requestAnimationFrame(() => {
			this.immersiveSyncFrame = 0;
			const queuedMode = this.lastQueuedImmersiveSyncMode || "auto";
			void (async () => {
				const selection = window.getSelection && window.getSelection();
				if (selection && selection.rangeCount && queuedMode === "selection") {
					await this.syncPageWithImmersiveSelection();
				} else if (selection && selection.rangeCount) {
					await this.syncPageToSelectionViewport(selection);
				} else if (queuedMode === "clone" || this.spreadDetached) {
					await this.syncPageFromImmersiveCloneViewport();
				} else {
					await this.syncPageFromViewport();
				}
				this.updatePageNumbers();
			})();
		});
	}

	setupImmersiveReaderObserver() {
		// Limpar observer anterior se existir
		if (this.immersiveReaderObserver) {
			this.immersiveReaderObserver.disconnect();
		}

		const readerElem = reader.util.loadElem("#reader");
		if (!readerElem) {
			return;
		}

		// Observer para monitorar mudanÃƒÂ§as no DOM causadas pelo Immersive Reader
		const self = this;
		this.immersiveReaderObserver = new MutationObserver(() => {
			const now = Date.now();
			if (now < (Number(self.fullscreenTransitionLockUntil) || 0)) {
				return;
			}
			if (self.pageObserver) {
				self.updatePageNumbers();
				return;
			}
			if (now < (Number(self.viewportSyncLockUntil) || 0)) {
				return;
			}
			const hasPagedSpread = !!readerElem.querySelector("#readerSpread, #readerSpreadClone");
			if (!hasPagedSpread) {
				return;
			}
            window.clearTimeout(self.immersiveObserverSyncTimer);
            self.immersiveObserverSyncTimer = window.setTimeout(() => {
                self.immersiveObserverSyncTimer = null;
                const selection = window.getSelection && window.getSelection();
                const selectionAnchor = self.getSelectionAnchorElement(selection);
                const linearRoot = reader.util.loadElem("#readerLinear");
                const selectionIsDriving = !!(selection && selection.rangeCount && selectionAnchor && linearRoot && linearRoot.contains(selectionAnchor));
                const container = reader.util.loadElem("#container");
                if (container && readerElem) {
                    const containerWidth = container.clientWidth || container.offsetWidth;
                    if (containerWidth > 0) {
                        const targetWidth = `${containerWidth}px`;
                        if (readerElem.style.width !== targetWidth) {
                            readerElem.style.setProperty("width", targetWidth, "important");
                        }
                        if (readerElem.style.maxWidth !== targetWidth) {
                            readerElem.style.setProperty("max-width", targetWidth, "important");
                        }
                        if (readerElem.style.overflowX !== "hidden") {
                            readerElem.style.setProperty("overflow-x", "hidden", "important");
                        }
                        if (readerElem.style.overflow !== "hidden") {
                            readerElem.style.setProperty("overflow", "hidden", "important");
                        }
                    }
                }
                if (!self.pageContent || !self.spreadElem) {
                    return;
                }
                if (self.spreadDetached) {
                    if (!selectionIsDriving) {
                        self.immersiveActiveUntil = Date.now() + 48;
                        self.queueImmersivePageSync("clone");
                    }
                    return;
                }
                self.immersiveActiveUntil = Date.now() + 48;
                self.queueImmersivePageSync(selection && selection.rangeCount ? "selection" : "viewport");
            }, 12);
        });

		// Observar mudanÃƒÂ§as no reader e no spread
		this.immersiveReaderObserver.observe(readerElem, {
			attributes: true,
			attributeFilter: ["style", "class"],
			childList: true,
			subtree: true
		});

		const spread = reader.util.loadElem("#readerSpread");
		if (spread) {
			this.immersiveReaderObserver.observe(spread, {
				attributes: true,
				attributeFilter: ["style", "class"],
				childList: true,
				subtree: true
			});
		}
	}
}





