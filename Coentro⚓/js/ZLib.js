class ZLib {
	constructor() {
		this.baseUrl = "https://pt.z-lib.fm";
		this.searchUrl = "https://pt.z-lib.fm/s";
	}

	// Get cookies for pt.z-lib.fm domain (works in both Chrome and Edge)
	async getCookies() {
		return new Promise((resolve, reject) => {
			// Try chrome.cookies first (works in both Chrome and Edge)
			const cookiesAPI = chrome.cookies || browser.cookies;
			if (!cookiesAPI) {
				reject(new Error("Cookies API not available"));
				return;
			}
			
			cookiesAPI.getAll({ domain: "pt.z-lib.fm" }, (cookies) => {
				if (chrome.runtime.lastError) {
					console.error("Error getting cookies:", chrome.runtime.lastError);
					resolve([]); // Return empty array instead of rejecting
					return;
				}
				resolve(cookies || []);
			});
		});
	}

	// Build cookie header string for fetch
	async getCookieHeader() {
		try {
			const cookies = await this.getCookies();
			if (cookies.length === 0) {
				return null;
			}
			return cookies.map(c => `${c.name}=${c.value}`).join("; ");
		} catch (error) {
			console.error("Error building cookie header:", error);
			return null;
		}
	}

	// Fetch HTML content with cookies (with retry logic)
	async fetchWithCookies(url, retries = 3) {
		// Get current User-Agent from navigator
		const userAgent = navigator.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				// Add delay between retries (exponential backoff)
				if (attempt > 0) {
					const delay = Math.pow(2, attempt) * 1000;
					console.log(`Waiting ${delay}ms before retry ${attempt + 1}...`);
					await new Promise(resolve => setTimeout(resolve, delay));
				}

				// Get cookies from Edge/Chrome cookies API
				const cookies = await this.getCookies();
				const cookieHeader = await this.getCookieHeader();
				
				// Build headers with cookies explicitly included
				// Edge/Chrome extensions need explicit cookie headers for cross-origin requests
				const headers = {
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
					"Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
					"Accept-Encoding": "gzip, deflate, br",
					"Referer": this.baseUrl,
					"User-Agent": userAgent,
					"Sec-Fetch-Dest": "document",
					"Sec-Fetch-Mode": "navigate",
					"Sec-Fetch-Site": "same-origin",
					"Sec-Fetch-User": "?1",
					"Upgrade-Insecure-Requests": "1",
					"Cache-Control": "max-age=0",
					"Origin": this.baseUrl
				};
				
				// Add cookies to header explicitly (required for Edge extensions)
				if (cookieHeader && cookieHeader.length > 0) {
					headers["Cookie"] = cookieHeader;
					console.log(`Sending ${cookies.length} cookies with request`);
				} else {
					console.warn("No cookies found for pt.z-lib.fm. Cookies may need to be set first.");
				}

				// Use fetch with credentials and explicit cookie header
				// Edge extensions require explicit cookie headers for cross-origin requests
				const response = await fetch(url, {
					method: "GET",
					headers: headers,
					credentials: "include", // Include cookies automatically (may not work in extension context)
					mode: "cors",
					redirect: "follow"
				});

				// Handle different status codes
				if (response.status === 503) {
					if (attempt < retries - 1) {
						console.log(`503 error, retrying... (attempt ${attempt + 1}/${retries})`);
						continue; // Retry
					}
					throw new Error("503: Service Unavailable. The server may be temporarily overloaded or blocking requests. Please try again later or open in a new tab.");
				}

				if (response.status === 429) {
					if (attempt < retries - 1) {
						const retryAfter = response.headers.get("Retry-After");
						const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt + 1) * 1000;
						console.log(`Rate limited, waiting ${delay}ms before retry...`);
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
					throw new Error("429: Too many requests. Please wait a moment and try again.");
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const html = await response.text();
				
				// Check if we got a cookie warning page
				if (html.includes("Cookies are required") || html.includes("enable them") || html.includes("Please enable cookies")) {
					throw new Error("cookies_required");
				}

				// Check if we got an error page
				if (html.includes("503") && (html.includes("Service Unavailable") || html.includes("temporarily unavailable"))) {
					if (attempt < retries - 1) {
						console.log(`Got 503 page, retrying... (attempt ${attempt + 1}/${retries})`);
						continue;
					}
					throw new Error("503: Service Unavailable page received.");
				}

				return html;
			} catch (error) {
				// If it's the last attempt, throw the error
				if (attempt === retries - 1) {
					console.error("Error fetching Z-Library content (final attempt):", error);
					throw error;
				}
				console.log(`Fetch attempt ${attempt + 1} failed, retrying...`, error.message);
			}
		}
	}

	// Parse search results from HTML
	parseSearchResults(html, extraJson = null) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");
		const results = [];
		const seen = new Set();

		// Check if we got the cookie warning page
		const bodyText = doc.body?.innerText || "";
		if (bodyText.includes("Cookies are required") || bodyText.includes("enable them") || bodyText.includes("Please enable cookies")) {
			return { error: "cookies_required", results: [] };
		}

		const normalizeUrl = (url) => {
			if (!url) return "";
			if (url.startsWith("http")) return url;
			if (url.startsWith("//")) return `https:${url}`;
			return `${this.baseUrl}${url}`;
		};

		const addResult = (data) => {
			if (!data) return;
			const title = (data.title || "").trim();
			if (!title || title.length < 3) return;
			const url = normalizeUrl(data.url || "");
			const key = `${title}::${url || "no-url"}`;
			if (seen.has(key)) return;
			seen.add(key);
			results.push({
				title,
				author: (data.author || "Unknown").trim() || "Unknown",
				year: (data.year || "").toString().trim(),
				language: (data.language || "").toString().trim(),
				extension: (data.extension || "").toString().trim(),
				size: (data.size || "").toString().trim(),
				url,
				coverUrl: normalizeUrl(data.coverUrl || "")
			});
		};

		// Try multiple selector strategies to find result items
		// Z-Library uses various structures, so we try multiple approaches
		let resultItems = doc.querySelectorAll(
			".resItemBox, .resItemBoxHover, " +
			".book-item, .bookItem, .book-card, .bookCard, .bookcard, " +
			".searchBook, .search-book, .z-bookcard, .z-book-card, " +
			"[id*='book'], [id*='Book'], " +
			".bookRow, .book-row, " +
			".searchResultItem, .search-result-item, " +
			"div[data-id], " +
			"article, " +
			".item, .result-item"
		);
		
		// If no results with primary selectors, try broader search
		if (resultItems.length === 0) {
			// Look for containers that might hold book results
			const containers = doc.querySelectorAll("div[class*='book'], div[class*='item'], div[class*='result'], div[class*='card']");
			resultItems = containers;
		}

		// If still no results, try finding by links to book pages
		if (resultItems.length === 0) {
			const bookLinks = doc.querySelectorAll("a[href*='/book/'], a[href*='/b/'], a[href*='/book']");
			if (bookLinks.length > 0) {
				// Extract from links directly
				bookLinks.forEach((link, index) => {
					if (index < 30) { // Limit results
						try {
							const title = link.textContent?.trim() || link.querySelector("span, div, h1, h2, h3, h4")?.textContent?.trim();
							if (title && title.length > 3 && !title.includes("http")) {
								const bookUrl = link.href || link.getAttribute("href") || "";
								const fullUrl = bookUrl.startsWith("http") ? bookUrl : `${this.baseUrl}${bookUrl}`;
								
								// Try to find author in nearby elements
								let author = "Unknown";
								const parent = link.closest("div, article, li");
								if (parent) {
									const authorText = parent.textContent;
									const authorMatch = authorText.match(/(?:by|author|autor)[:\s]+([^,\n]+)/i);
									if (authorMatch) {
										author = authorMatch[1].trim();
									}
								}
								
								addResult({
									title,
									author,
									url: fullUrl
								});
							}
						} catch (e) {
							console.error("Error parsing link:", e);
						}
					}
				});
				return { results, total: results.length };
			}
		}

		// Parse structured result items
		resultItems.forEach((item, index) => {
			try {
				// Extract book information with multiple selector strategies
				const titleElem = item.querySelector(
					"h3 a, h2 a, h1 a, " +
					".itemTitle a, .bookTitle a, .title a, " +
					"a[href*='/book/'], a[href*='/b/'], " +
					".title, h3, h2"
				);
				
				let title = "";
				let bookUrl = "";
				
				if (titleElem) {
					title = titleElem.textContent?.trim() || titleElem.innerText?.trim() || "";
					bookUrl = titleElem.href || titleElem.getAttribute("href") || "";
					
					// If titleElem is not a link, try to find link nearby
					if (!bookUrl && titleElem.tagName !== "A") {
						const link = titleElem.querySelector("a") || titleElem.closest("a");
						if (link) {
							bookUrl = link.href || link.getAttribute("href") || "";
						}
					}
				}
				
				// Fallback: try to find any link in the item
				if (!bookUrl) {
					const anyLink = item.querySelector("a[href*='/book/'], a[href*='/b/']");
					if (anyLink) {
						bookUrl = anyLink.href || anyLink.getAttribute("href") || "";
						if (!title) {
							title = anyLink.textContent?.trim() || "";
						}
					}
				}
				
				const fullUrl = bookUrl.startsWith("http") ? bookUrl : (bookUrl ? `${this.baseUrl}${bookUrl}` : "");

				// Extract author with multiple strategies
				let author = "Unknown";
				const authorElem = item.querySelector(
					".authors, .author, [class*='author'], " +
					"[class*='Author'], .by"
				);
				if (authorElem) {
					author = authorElem.textContent?.trim().replace(/^(by|author|autor)[:\s]+/i, "") || "Unknown";
				} else {
					// Try to extract from text content
					const itemText = item.textContent || "";
					const authorMatch = itemText.match(/(?:by|author|autor)[:\s]+([^,\n\r]+)/i);
					if (authorMatch) {
						author = authorMatch[1].trim();
					}
				}

				// Extract cover image
				const coverElem = item.querySelector("img, .cover img, .bookCover img, [class*='cover'] img");
				let coverUrl = "";
				if (coverElem) {
					coverUrl = coverElem.src || coverElem.getAttribute("src") || coverElem.getAttribute("data-src") || "";
				}
				const fullCoverUrl = coverUrl.startsWith("http") ? coverUrl : (coverUrl ? `${this.baseUrl}${coverUrl}` : "");

				// Extract metadata
				const yearElem = item.querySelector(".property_year, .year, [class*='year'], [data-year]");
				const year = yearElem?.textContent?.trim() || yearElem?.getAttribute("data-year") || "";

				const languageElem = item.querySelector(".property_language, .language, [class*='language'], [data-language]");
				const language = languageElem?.textContent?.trim() || languageElem?.getAttribute("data-language") || "";

				const extensionElem = item.querySelector(".property_type, .extension, [class*='extension'], [data-extension]");
				const extension = extensionElem?.textContent?.trim() || extensionElem?.getAttribute("data-extension") || "";

				const sizeElem = item.querySelector(".property_size, .size, [class*='size'], [data-size]");
				const size = sizeElem?.textContent?.trim() || sizeElem?.getAttribute("data-size") || "";

				if (title && title.length > 2 && title !== "Unknown Title") {
					addResult({
						title,
						author: author !== "Unknown" ? author : "Unknown",
						year,
						language,
						extension,
						size,
						url: fullUrl,
						coverUrl: fullCoverUrl
					});
				}
			} catch (e) {
				console.error("Error parsing result item:", e);
			}
		});

		// If no results, try to extract from JSON data embedded in scripts (SPA pages)
		const parseEmbeddedJson = (jsonText) => {
			if (!jsonText || typeof jsonText !== "string") return;
			let data;
			try {
				data = JSON.parse(jsonText);
			} catch (e) {
				return;
			}
			const seed = [];
			if (data && typeof data === "object") {
				if (Array.isArray(data.results)) seed.push(...data.results);
				if (Array.isArray(data.items)) seed.push(...data.items);
				if (Array.isArray(data.books)) seed.push(...data.books);
			}
			const stack = [data];
			seed.forEach(s => stack.push(s));
			while (stack.length) {
				const node = stack.pop();
				if (!node) continue;
				if (Array.isArray(node)) {
					node.forEach(n => stack.push(n));
					continue;
				}
				if (typeof node === "object") {
					if (node.book && typeof node.book === "object") {
						stack.push(node.book);
					}
					const hasTitle = typeof node.title === "string" || typeof node.name === "string";
					const hasSignals = "author" in node || "authors" in node || "year" in node || "language" in node || "extension" in node || "size" in node || "id" in node;
					if (hasTitle && hasSignals) {
						const title = (node.title || node.name || "").toString();
						let author = "";
						if (typeof node.author === "string") author = node.author;
						if (!author && Array.isArray(node.authors)) author = node.authors.join(", ");
						const url = node.url || node.href || node.link || (node.id ? `/book/${node.id}` : "");
						const cover = node.cover || node.coverUrl || node.image || node.img || "";
						addResult({
							title,
							author,
							year: node.year || node.year_published || node.pubYear || "",
							language: node.language || node.lang || "",
							extension: node.extension || node.fileExtension || "",
							size: node.size || node.filesize || "",
							url,
							coverUrl: cover
						});
					}
					Object.values(node).forEach(v => stack.push(v));
				}
			}
		};

		if (results.length === 0 && extraJson) {
			parseEmbeddedJson(extraJson);
		}

		if (results.length === 0) {
			const jsonScripts = Array.from(doc.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__"));
			jsonScripts.forEach((script) => {
				const text = script.textContent?.trim();
				if (!text) return;
				parseEmbeddedJson(text);
			});
		}

		return { results, total: results.length };
	}

	// Ensure Z-Library tab exists (opens in background automatically) - only when needed
	async ensureZLibTab() {
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage(
				{ action: "ensureZLibTab" },
				(response) => {
					if (chrome.runtime.lastError) {
						reject(new Error(chrome.runtime.lastError.message));
						return;
					}
					if (response && response.success) {
						resolve(response.tabId);
					} else {
						reject(new Error(response?.error || "Failed to ensure Z-Library tab"));
					}
				}
			);
		});
	}

	// Search using background script (preferred method - runs in page context)
	async searchViaBackground(url) {
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage(
				{ action: "searchZLib", url: url },
				(response) => {
					if (chrome.runtime.lastError) {
						reject(new Error(chrome.runtime.lastError.message));
						return;
					}
					if (response && response.success) {
						resolve({ html: response.html, origin: response.origin, nextData: response.nextData, nuxtData: response.nuxtData });
					} else {
						reject(new Error(response?.error || "Unknown error"));
					}
				}
			);
		});
	}

	// Search and get results
	async search(search, filters = {}) {
		const url = this.buildSearchUrl(search, filters);
		const minWaitMs = 20000;
		const maxAttempts = 2;
		const startTime = Date.now();

		try {
			let html = null;
			let parsed = null;
			let extraJson = null;

			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				// Prefer background execution (page context), then fallback to direct fetch.
				try {
					const bg = await this.searchViaBackground(url);
					if (bg && bg.origin) {
						this.baseUrl = bg.origin;
						this.searchUrl = `${bg.origin}/s`;
					}
					html = bg?.html || "";
					extraJson = bg?.nextData || bg?.nuxtData || null;
				} catch (backgroundError) {
					console.warn("Background search failed, falling back to direct fetch:", backgroundError);
					html = await this.fetchWithCookies(url);
				}

				parsed = this.parseSearchResults(html, extraJson);
				if (parsed.error) {
					return {
						results: [],
						total: 0,
						searchUrl: url,
						error: parsed.error
					};
				}

				if (parsed.results && parsed.results.length > 0) {
					return {
						results: parsed.results || [],
						total: parsed.total || (parsed.results ? parsed.results.length : 0),
						searchUrl: url
					};
				}

				// If empty, wait until minimum time passes before retrying.
				const elapsed = Date.now() - startTime;
				const waitMs = Math.max(0, minWaitMs - elapsed);
				if (waitMs > 0 && attempt < maxAttempts - 1) {
					await new Promise(resolve => setTimeout(resolve, waitMs));
				}
			}

			return {
				results: [],
				total: 0,
				searchUrl: url
			};
		} catch (error) {
			return {
				results: [],
				total: 0,
				searchUrl: url,
				error: error?.message || String(error)
			};
		}
	}

	buildSearchUrl(search, filters = {}) {
		// Build URL with search term in 'q' parameter, not in path
		const urlObj = new URL(this.searchUrl);
		
		// Search query must be in 'q' parameter
		if (search && search.trim()) {
			urlObj.searchParams.append("q", search.trim());
		}
		
		if (filters.yearFrom && filters.yearFrom !== "") {
			urlObj.searchParams.append("yearFrom", filters.yearFrom);
		}
		
		if (filters.yearTo && filters.yearTo !== "") {
			urlObj.searchParams.append("yearTo", filters.yearTo);
		}
		
		if (filters.language && filters.language !== "Any Language") {
			// Z-Library expects lowercase language codes
			const languageCode = filters.language.toLowerCase();
			urlObj.searchParams.append("languages[]", languageCode);
		}
		
		if (filters.extension && filters.extension !== "Any Extension") {
			// Z-Library expects uppercase extension codes
			let extCode = filters.extension.toUpperCase();
			if (extCode === "AVAILABLE FOR KINDLE") {
				extCode = "KINDLE";
			}
			urlObj.searchParams.append("extensions[]", extCode);
		}
		
		if (filters.type && filters.type !== "Any Type of Content") {
			// Z-Library uses 'selected_content_types[]' with singular values
			let typeCode = filters.type.toLowerCase();
			// Convert plural to singular
			if (typeCode === "books") {
				typeCode = "book";
			} else if (typeCode === "articles") {
				typeCode = "article";
			}
			urlObj.searchParams.append("selected_content_types[]", typeCode);
		}
		
		return urlObj.toString();
	}

	getLanguages() {
		return [
			"Any Language",
			"Arabic", "Armenian", "Azerbaijani", "Bengali", "Chinese", "Dutch", "English", "French",
			"Georgian", "German", "Greek", "Hindi", "Indonesian", "Italian", "Japanese", "Korean",
			"Malaysian", "Pashto", "Polish", "Portuguese", "Russian", "Serbian", "Spanish", "Telugu",
			"Thai", "Traditional Chinese", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
			"Abkhazian", "Afar", "Afrikaans", "Akan", "Albanian", "Amharic", "Aragonese", "Assamese",
			"Avaric", "Avestan", "Aymara", "Bambara", "Bashkir", "Basque", "Belarusian", "Berber",
			"Bislama", "Bosnian", "Brazilian Portuguese", "Breton", "Bulgarian", "Burmese", "Catalan",
			"Central Khmer", "Chamorro", "Chechen", "Chichewa", "Church Slavic", "Chuvash", "Cornish",
			"Corsican", "Cree", "Crimean Tatar", "Croatian", "Czech", "Danish", "Divehi", "Dzongkha",
			"Esperanto", "Estonian", "Ewe", "Faroese", "Fijian", "Finnish", "Fulah", "Gaelic",
			"Galician", "Ganda", "Guarani", "Gujarati", "Haitian", "Hausa", "Hebrew", "Herero",
			"Hiri Motu", "Hungarian", "Icelandic", "Ido", "Igbo", "Indigenous", "Interlingua",
			"Inuktitut", "Inupiaq", "Irish", "Javanese", "Kalaallisut", "Kannada", "Kanuri",
			"Karakalpak", "Kashmiri", "Kazakh", "Kikuyu", "Kinyarwanda", "Kirghiz", "Komi", "Kongo",
			"Kuanyama", "Kurdish", "Lao", "Latin", "Latvian", "Limburgan", "Lingala", "Lithuanian",
			"Luba-Katanga", "Luxembourgish", "Macedonian", "Malagasy", "Malayalam", "Maltese", "Manx",
			"Maori", "Marathi", "Marshallese", "Moldavian", "Mongolian", "Nauru", "Navajo", "Ndonga",
			"Nepali", "North Ndebele", "Northern Sami", "Norwegian", "Norwegian Bokmål", "Norwegian Nynorsk",
			"Occidental", "Occitan", "Odia", "Ojibwa", "Oromo", "Ossetian", "Pali", "Persian",
			"Punjabi", "Quechua", "Romanian", "Romansh", "Rundi", "Samoan", "Sango", "Sanskrit",
			"Sardinian", "Shona", "Sichuan Yi", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali",
			"South Ndebele", "Southern Sotho", "Sundanese", "Swahili", "Swati", "Swedish",
			"Tagalog (Filipino)", "Tahitian", "Tajik", "Tamil", "Tatar", "Tibetan", "Tigrinya",
			"Tonga", "Tsonga", "Tswana", "Turkmen", "Twi", "Uighur", "Uzbek", "Venda", "Volapük",
			"Walloon", "Welsh", "Western Frisian", "Wolof", "Xhosa", "Yakut", "Yiddish", "Yoruba",
			"Zhuang", "Zulu"
		];
	}

	getExtensions() {
		return [
			"Any Extension",
			"Available for Kindle",
			"AZW",
			"AZW3",
			"CBZ",
			"DJV",
			"DJVU",
			"EPUB",
			"FB2",
			"LIT",
			"MOBI",
			"PDF",
			"RTF",
			"TXT"
		];
	}

	getContentTypes() {
		return [
			"Any Type of Content",
			"Books",
			"Articles"
		];
	}
}
