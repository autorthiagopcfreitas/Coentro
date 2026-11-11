const defaultSettings = {
	fontSize: 16,
	theme: "night",
	maxWidth: 1500,
	lineSpacing: 1.35,
	font: "serif",
	textColor: "#1a1a1a",
	backgroundColor: "#ff7a3d",
	readerColorSource: "custom",
	readerThemePreset: "night",
	interfaceColor: "#1877f2",
	interfaceBackgroundColor: "",
	interfaceTextColor: "",
	mainMenuBackgroundColor: "",
	mainMenuTextColor: "",
	themeMode: "light",
	pageViewMode: "two",
	readerMargin: 50,
	showNavArrows: true,
	tapToNavigate: true,
	returnWithSearchBox: true,
	preferredLanguage: "pt",
	translateBooks: false,
	translationProvider: "google",
	translationApiKey: "",
	translationApiUrl: "http://127.0.0.1:8000/translate",
	translationModel: "facebook/nllb-200-distilled-600M",
	readerShowTranslatedText: true,
	hideOceanPdfWatermark: false,
	columnMarkerColor: "",
	navArrowStyle: "classic",
	navArrowColor: "#1877f2",
	merriamWebsterApiKey: "",
	synopsisSidebarWidth: "one-third",
	readerSearchFontFamily: "Helvetica, Arial, sans-serif",
	readerSearchFontSize: 16,
	readerSearchBackgroundColor: "#adff2f",
	readerSearchTextColor: "#ffffff",
	readerSearchWindowWidth: 960,
	readerSearchWindowHeight: 320
};

class Store {
	coerceBooleanSettingValue(value, fallback = false) {
		if (typeof value === "boolean") {
			return value;
		}
		if (typeof value === "number") {
			return value !== 0;
		}
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (["true", "1", "yes", "on", "sim"].includes(normalized)) {
				return true;
			}
			if (["false", "0", "no", "off", "nao", "não", ""].includes(normalized)) {
				return false;
			}
		}
		return !!fallback;
	}

	normalizeSettingValue(setting, value) {
		if (value === null || value === undefined) {
			return null;
		}
		if (!Object.prototype.hasOwnProperty.call(defaultSettings, setting)) {
			return value;
		}
		const defaultValue = defaultSettings[setting];
		if (typeof defaultValue === "boolean") {
			return this.coerceBooleanSettingValue(value, defaultValue);
		}
		if (typeof defaultValue === "number") {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : defaultValue;
		}
		if (typeof defaultValue === "string") {
			return String(value);
		}
		return value;
	}

	async loadSetting(setting) {
		const settings = (await this.get("settings")) || {};
		if (!Object.prototype.hasOwnProperty.call(settings, setting)) {
			return null;
		}
		return this.normalizeSettingValue(setting, settings[setting]);
	}

	async updateSetting(setting, value) {
		const settings = await this.get("settings");

		settings[setting] = value;

		await this.set("settings", settings);
	}

	async resetSettingsToDefault() {
		await this.set("settings", { ...defaultSettings });
	}

	async loadLibrary() {
		return await this.get("library");
	}

	async saveBookOrder(order) {
		await this.set("bookOrder", order);
	}

	async loadBookOrder() {
		return await this.get("bookOrder") || null;
	}

	async moveBookToEnd(title) {
		const bookOrder = await this.loadBookOrder();
		if (!bookOrder) {
			// If no order exists, create one from current library
			const library = await this.loadLibrary();
			const newOrder = library.map(book => book.title);
			// Move the completed book to end
			const index = newOrder.indexOf(title);
			if (index !== -1) {
				newOrder.splice(index, 1);
				newOrder.push(title);
				await this.saveBookOrder(newOrder);
			}
			return;
		}
		
		// Move book to end if it exists in order
		const index = bookOrder.indexOf(title);
		if (index !== -1) {
			bookOrder.splice(index, 1);
			bookOrder.push(title);
			await this.saveBookOrder(bookOrder);
		}
	}

	async loadBookStatuses() {
		return (await this.get("bookStatuses")) || {};
	}

	async loadBookStatus(title) {
		const statuses = await this.loadBookStatuses();
		return statuses[title] || null;
	}

	async setBookStatus(title, status, options = {}) {
		const statuses = await this.loadBookStatuses();
		const previousStatus = statuses[title] || null;
		if (options.preserveRead && statuses[title] === "read") {
			return;
		}
		statuses[title] = status;
		await this.set("bookStatuses", statuses);
		if (status === "read" && previousStatus !== "read") {
			await this.addBookCompletionEvent(title, Date.now());
		}
	}

	async loadBookCompletionEvents() {
		const events = (await this.get("bookCompletionEvents")) || [];
		if (!Array.isArray(events)) {
			return [];
		}
		return events.filter(entry => entry && typeof entry === "object");
	}

	async addBookCompletionEvent(title, completedAt = Date.now()) {
		const events = await this.loadBookCompletionEvents();
		events.push({
			title: String(title || "").trim(),
			completedAt: Number(completedAt) || Date.now()
		});
		await this.set("bookCompletionEvents", events);
	}

	async loadBook(title) {
		return await this.get("library-" + title.replaceAll(/[^\w]/g, ""));
	}

	async touchBookOpened(title, openedAt = Date.now()) {
		const library = (await this.get("library")) || [];
		let changed = false;
		for (const item of library) {
			if (item?.title === title) {
				item.lastOpened = openedAt;
				changed = true;
				break;
			}
		}
		if (changed) {
			await this.set("library", library);
		}
	}

	async saveBook(book) {
		const library = await this.get("library");

		library.push({
			title: book.title,
			size: book.size,
			cover: book.cover,
			attributes: book.attributes,
			lastOpened: Date.now()
		});

		await this.set("library", library);
		await this.set("library-" + book.title.replaceAll(/[^\w]/g, ""), book);

		const statuses = await this.loadBookStatuses();
		if (!statuses[book.title]) {
			statuses[book.title] = "want";
			await this.set("bookStatuses", statuses);
		}
	}

	async removeFromLibrary(title) {
		const library = await this.get("library");

		const newLibrary = library.filter(book => book.title !== title);

		await this.set("library", newLibrary);
		await this.set("library-" + title.replaceAll(/[^\w]/g, ""), null);

		const statuses = await this.loadBookStatuses();
		if (statuses[title]) {
			delete statuses[title];
			await this.set("bookStatuses", statuses);
		}

		const immersiveWords = (await this.get("immersiveLastWords")) || {};
		const normalizedTitle = this._normalizePositionKey(title);
		let changed = false;
		for (const key of Object.keys(immersiveWords)) {
			const normalizedKeyTitle = this._normalizePositionKey(String(key).split("__")[0] || "");
			if (normalizedKeyTitle === normalizedTitle) {
				delete immersiveWords[key];
				changed = true;
			}
		}
		if (changed) {
			await this.set("immersiveLastWords", immersiveWords);
		}
	}

	_normalizePositionKey(title) {
		return String(title || "").trim().replace(/\s+/g, " ");
	}

	_buildBookPositionKey(bookOrTitle) {
		if (!bookOrTitle || typeof bookOrTitle !== "object") {
			return this._normalizePositionKey(bookOrTitle);
		}
		const title = this._normalizePositionKey(bookOrTitle.title || "");
		const creator = this._normalizePositionKey(bookOrTitle.attributes?.Creator || "");
		const identifier = this._normalizePositionKey(bookOrTitle.attributes?.Identifier || "");
		if (!title) {
			return this._normalizePositionKey("");
		}
		if (!creator && !identifier) {
			return title;
		}
		return `${title}__${creator}__${identifier}`;
	}

	_getPositionLookupKeys(bookOrTitle) {
		const keys = [];
		if (bookOrTitle && typeof bookOrTitle === "object") {
			const composite = this._buildBookPositionKey(bookOrTitle);
			if (composite) {
				keys.push(composite);
			}
			const title = this._normalizePositionKey(bookOrTitle.title || "");
			if (title) {
				keys.push(title);
			}
		} else {
			const key = this._normalizePositionKey(bookOrTitle);
			if (key) {
				keys.push(key);
			}
			const rawTitle = String(bookOrTitle || "");
			if (rawTitle && !keys.includes(rawTitle)) {
				keys.push(rawTitle);
			}
			const trimmed = rawTitle.trim();
			if (trimmed && !keys.includes(trimmed)) {
				keys.push(trimmed);
			}
		}
		return [...new Set(keys)];
	}

	async loadPosition(bookOrTitle) {
		const positions = (await this.get("positions")) || {};
		for (const key of this._getPositionLookupKeys(bookOrTitle)) {
			if (positions[key]) {
				return positions[key];
			}
		}
		const normalizedLookup = this._normalizePositionKey(
			(bookOrTitle && typeof bookOrTitle === "object") ? bookOrTitle.title : bookOrTitle
		);
		const match = Object.keys(positions).find(k => this._normalizePositionKey(k) === normalizedLookup);
		return match ? positions[match] : { chapter: 0, anchor: 0, percentage: 0, page: 0, globalAnchor: 0, chapterGlobalAnchor: 0, pagePercentage: 0 };
	}

	async setPosition(bookOrTitle, chapter, anchor, percentage, page = null, globalAnchor = null, chapterGlobalAnchor = null, pagePercentage = null) {
		const positions = (await this.get("positions")) || {};
		const key = this._buildBookPositionKey(bookOrTitle);
		const prev = positions[key] || {};
		const position = { chapter, anchor, percentage };
		const parsedPage = Number(page);
		if (Number.isFinite(parsedPage) && parsedPage >= 0) {
			position.page = Math.floor(parsedPage);
		} else if (Number.isFinite(Number(prev.page)) && Number(prev.page) >= 0) {
			position.page = Math.floor(Number(prev.page));
		}
		const parsedGlobalAnchor = Number(globalAnchor);
		if (Number.isFinite(parsedGlobalAnchor) && parsedGlobalAnchor >= 0) {
			position.globalAnchor = Math.floor(parsedGlobalAnchor);
		} else if (Number.isFinite(Number(prev.globalAnchor)) && Number(prev.globalAnchor) >= 0) {
			position.globalAnchor = Math.floor(Number(prev.globalAnchor));
		}
		const parsedChapterGlobalAnchor = Number(chapterGlobalAnchor);
		if (Number.isFinite(parsedChapterGlobalAnchor) && parsedChapterGlobalAnchor >= 0) {
			position.chapterGlobalAnchor = Math.floor(parsedChapterGlobalAnchor);
		} else if (Number.isFinite(Number(prev.chapterGlobalAnchor)) && Number(prev.chapterGlobalAnchor) >= 0) {
			position.chapterGlobalAnchor = Math.floor(Number(prev.chapterGlobalAnchor));
		}
		const parsedPagePercentage = Number(pagePercentage);
		if (Number.isFinite(parsedPagePercentage) && parsedPagePercentage >= 0) {
			position.pagePercentage = Math.max(0, Math.min(100, parsedPagePercentage));
		} else if (Number.isFinite(Number(prev.pagePercentage)) && Number(prev.pagePercentage) >= 0) {
			position.pagePercentage = Math.max(0, Math.min(100, Number(prev.pagePercentage)));
		}
		positions[key] = position;
		await this.set("positions", positions);
	}

	async loadImmersiveLastWord(bookOrTitle) {
		const words = (await this.get("immersiveLastWords")) || {};
		for (const key of this._getPositionLookupKeys(bookOrTitle)) {
			if (words[key]) {
				return words[key];
			}
		}
		const normalizedLookup = this._normalizePositionKey(
			(bookOrTitle && typeof bookOrTitle === "object") ? bookOrTitle.title : bookOrTitle
		);
		const match = Object.keys(words).find(k => this._normalizePositionKey(String(k).split("__")[0] || "") === normalizedLookup);
		return match ? words[match] : null;
	}

	async setImmersiveLastWord(bookOrTitle, payload) {
		if (!payload || typeof payload !== "object") {
			return;
		}
		const words = (await this.get("immersiveLastWords")) || {};
		const key = this._buildBookPositionKey(bookOrTitle);
		if (!key) {
			return;
		}
		words[key] = payload;
		await this.set("immersiveLastWords", words);
	}

	async initializeStore() {
		if (!(await this.get("settings"))) {
			await this.set("settings", defaultSettings);
		}

		if (!(await this.get("library"))) {
			await this.set("library", []);
		}

		if (!(await this.get("positions"))) {
			await this.set("positions", {});
		}

		if (!(await this.get("immersiveLastWords"))) {
			await this.set("immersiveLastWords", {});
		}

		if (!(await this.get("bookStatuses"))) {
			await this.set("bookStatuses", {});
		}
		if (!(await this.get("bookCompletionEvents"))) {
			await this.set("bookCompletionEvents", []);
		}

		const existingReadingStats = await this.get("readingStats");
		if (!existingReadingStats) {
			await this.set("readingStats", {
				days: {},
				words: {},
				dayParts: {},
				goal: 300
			});
		} else {
			if (!existingReadingStats.days) {
				existingReadingStats.days = {};
			}
			if (!existingReadingStats.words) {
				existingReadingStats.words = {};
			}
			if (!existingReadingStats.dayParts) {
				existingReadingStats.dayParts = {};
			}
			if (!existingReadingStats.goal) {
				existingReadingStats.goal = 300;
			}
			await this.set("readingStats", existingReadingStats);
		}

		for (const setting in defaultSettings) {
			if ((await this.loadSetting(setting)) === null) {
				await this.updateSetting(setting, defaultSettings[setting]);
			}
		}
	}

	async addReadingTime(time) {
		const readingStats = await this.getReadingStats();

		const now = new Date();
		const today = reader.util.getDateString(now);
		const part = this.getDayPart(now);

		if (!readingStats.days[today]) {
			readingStats.days[today] = 0;
		}

		readingStats.days[today] += time;

		if (!readingStats.dayParts[today]) {
			readingStats.dayParts[today] = { morning: 0, afternoon: 0, night: 0 };
		}
		if (!readingStats.dayParts[today][part]) {
			readingStats.dayParts[today][part] = 0;
		}
		readingStats.dayParts[today][part] += time;

		await this.set("readingStats", readingStats);
	}

	async addWordsRead(words) {
		const readingStats = await this.getReadingStats();
		const today = reader.util.getDateString(new Date());

		if (!readingStats.words[today]) {
			readingStats.words[today] = 0;
		}

		readingStats.words[today] += words;

		await this.set("readingStats", readingStats);
	}

	async getReadingStats() {
		const readingStats = (await this.get("readingStats")) || {};
		if (!readingStats.days) {
			readingStats.days = {};
		}
		if (!readingStats.words) {
			readingStats.words = {};
		}
		if (!readingStats.dayParts) {
			readingStats.dayParts = {};
		}
		if (!readingStats.goal) {
			readingStats.goal = 300;
		}
		return readingStats;
	}

	getDayPart(date) {
		const hour = date.getHours();
		if (hour >= 6 && hour < 12) {
			return "morning";
		}
		if (hour >= 12 && hour < 18) {
			return "afternoon";
		}
		return "night";
	}

	async get(item) {
		const promise = new Promise((resolve, _reject) => {
			chrome.storage.local.get(item, (result) => {
				resolve(result[item]);
			});
		});

		return promise;
	}

	async set(item, value) {
		const promise = new Promise((resolve, _reject) => {
			chrome.storage.local.set({ [item]: value }, () => {
				resolve();
			});
		});

		return promise;
	}
}
