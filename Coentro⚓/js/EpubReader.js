class EpubReader {
	constructor(container) {
		this.container = container;

		this.inputManager = new InputManager();
		this.store = new Store();
		this.util = new Util();
		this.renderer = new Renderer({});
		this.loader = new Loader({});
		this.interface = new Interface(this.container, this.inputManager);
		this.zlib = new ZLib();
		this.bookOpenInFlight = false;
		this.bookOpenPromise = null;
		this.queuedBookOpen = null;
		this.autoOpenToken = 0;
	}

	async init() {
		this.interface.loadTheme(await this.store.loadSetting("theme"));
		await this.interface.applyInterfaceColorFromSettings();
		this.interface.createLibrary();
	}

	async fileLoaded(file, options = {}) {
		const isFileList = typeof FileList !== "undefined" && file instanceof FileList;
		const isArray = Array.isArray(file);
		if ((isFileList || isArray) && file.length) {
			await this.fileLoadedBatch(file, options);
			return;
		}
		const beforeLibrary = (await this.store.loadLibrary()) || [];
		const beforeCount = beforeLibrary.length;
		const book = await this.loader.load(file);
		const afterLibrary = (await this.store.loadLibrary()) || [];
		const afterCount = afterLibrary.length;
		if (afterCount === beforeCount + 1 && afterCount <= 3) {
			this.interface.playPodiumSound(afterCount);
		}
		const openAfter = options.openAfter !== false;
		const openToken = options.openToken ?? this.autoOpenToken;
		if (openAfter && openToken === this.autoOpenToken) {
			this.bookLoaded(book);
		}
	}

	async fileLoadedBatch(files, options = {}) {
		const list = Array.from(files || []);
		if (!list.length) {
			return;
		}
		const batchToken = options.openToken ?? this.autoOpenToken;
		const openLast = options.openLast !== false;
		for (let i = 0; i < list.length; i++) {
			const openAfter = openLast && i === list.length - 1;
			await this.fileLoaded(list[i], { openAfter, openToken: batchToken });
		}
	}

	cancelPendingAutoOpen() {
		this.autoOpenToken += 1;
	}

	async loadRendererWithTimeout(book, position, _timeoutMs = 0) {
		await this.renderer.load(book, position);
	}

	getDetectedBookLanguageCode(book) {
		try {
			if (this.renderer && typeof this.renderer.getDetectedBookLanguageCode === "function") {
				return this.renderer.getDetectedBookLanguageCode(book);
			}
		} catch (_error) {}
		const raw = String(
			book?.attributes?.Language ||
			book?.attributes?.language ||
			book?.attributes?.LanguageDetected ||
			""
		);
		const normalized = this.util.normalizeLanguageCode(raw);
		return normalized || "unknown";
	}

	async getBookOpenTimeoutMs(book) {
		return 0;
	}

	async bookLoaded(book) {
		if (!book || !Array.isArray(book.contents) || !book.contents.length) {
			throw new Error("Invalid book or empty content.");
		}
		const bookKey = this.util.getBookIdentityKey(book) || String(book?.title || "").trim();
		if (this.bookOpenInFlight) {
			this.queuedBookOpen = book;
			return this.bookOpenPromise || Promise.resolve();
		}
		this.bookOpenInFlight = true;
		this.bookOpenPromise = (async () => {
			try {
				let position = await this.store.loadPosition(book);
				const hasSavedPosition = !!position && (
					(Number(position.chapter) || 0) > 0 ||
					(Number(position.anchor) || 0) > 0 ||
					(Number(position.percentage) || 0) > 0 ||
					(Number(position.page) || 0) > 0 ||
					(Number(position.globalAnchor) || 0) > 0 ||
					(Number(position.chapterGlobalAnchor) || 0) > 0 ||
					(Number(position.pagePercentage) || 0) > 0
				);
				if (!position || typeof position !== "object") {
					position = { chapter: 0, anchor: 0, percentage: 0, page: 0, globalAnchor: 0, chapterGlobalAnchor: 0, pagePercentage: 0 };
				}

				const chapterCount = Array.isArray(book?.contents) ? book.contents.length : 0;
				const safeChapter = Math.max(0, Math.min(Number(position.chapter) || 0, Math.max(0, chapterCount - 1)));
				const safeAnchor = Math.max(0, Number(position.anchor) || 0);
				const safePage = Math.max(0, Number(position.page) || 0);
				const safeGlobalAnchor = Math.max(0, Number(position.globalAnchor) || 0);
				const safeChapterGlobalAnchor = Math.max(0, Number(position.chapterGlobalAnchor) || 0);
				const safePagePercentage = Math.max(0, Math.min(100, Number(position.pagePercentage) || 0));
				const pct = typeof position.percentage === "number" ? position.percentage : parseFloat(String(position.percentage || "0").replace(",", ".")) || 0;
				const normalizedPct = Math.max(0, Math.min(100, pct));
				const shouldStartAtBeginning = !hasSavedPosition;

				const safePosition = {
					chapter: shouldStartAtBeginning ? 0 : safeChapter,
					anchor: shouldStartAtBeginning ? 0 : safeAnchor,
					page: shouldStartAtBeginning ? 0 : safePage,
					globalAnchor: shouldStartAtBeginning ? 0 : safeGlobalAnchor,
					chapterGlobalAnchor: shouldStartAtBeginning ? 0 : safeChapterGlobalAnchor,
					pagePercentage: shouldStartAtBeginning ? 0 : safePagePercentage,
					percentage: normalizedPct,
					isFirstOpen: !hasSavedPosition || shouldStartAtBeginning,
					forceBeginning: shouldStartAtBeginning
				};

				this.util.setTitle(book.title);
				await this.store.touchBookOpened(book.title);
				await this.store.setBookStatus(book.title, "reading", { preserveRead: true });

				const retryDelays = [0];
				let lastError = null;
				const openTimeoutMs = await this.getBookOpenTimeoutMs(book);

				for (let attempt = 0; attempt < retryDelays.length; attempt++) {
					if (retryDelays[attempt] > 0) {
						await new Promise(resolve => window.setTimeout(resolve, retryDelays[attempt]));
					}
					try {
						if (attempt > 0) {
							try {
								await this.renderer.close();
							} catch (_closeErr) {}
							this.renderer = new Renderer({});
						}

						const elements = this.interface.createReader();
						this.renderer.container = elements.reader;
						this.renderer.overlay = elements.overlay;
						await this.loadRendererWithTimeout(book, safePosition, openTimeoutMs);
						const preserveSearchOnReturn = await this.interface.shouldReturnWithSearchBox();
						if (preserveSearchOnReturn) {
							const savedSearchState = this.interface.getReaderSearchState(book.title);
							if (savedSearchState && typeof this.renderer.restoreReaderSearchState === "function") {
								this.renderer.restoreReaderSearchState(savedSearchState);
							}
						}
						return;
					} catch (err) {
						lastError = err;
						console.error(`Book open failed (attempt ${attempt + 1}/${retryDelays.length}).`, err);
						try {
							reader.util.loadElem("#readerLoading")?.hide();
						} catch (_hideErr) {}
					}
				}

				throw lastError || new Error("Unknown failure while opening book.");
			} finally {
				const queuedBook = this.queuedBookOpen;
				this.queuedBookOpen = null;
				this.bookOpenPromise = null;
				this.bookOpenInFlight = false;
				const queuedBookKey = queuedBook ? (this.util.getBookIdentityKey(queuedBook) || String(queuedBook?.title || "").trim()) : "";
				if (queuedBook && queuedBookKey && queuedBookKey !== bookKey) {
					void this.bookLoaded(queuedBook);
				}
			}
		})();
		try {
			await this.bookOpenPromise;
		} finally {
			this.bookOpenInFlight = false;
		}
	}
}
