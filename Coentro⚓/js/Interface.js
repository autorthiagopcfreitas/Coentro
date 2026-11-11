class Interface {
    constructor(container, inputManager) {
        this.container = container;
        this.currentlyRendering = false;

        this.librarySearchTerm = "";
        this.libraryFormat = "grid";
        this.libraryFilter = "last-opened";
        this.libraryDescending = true;

        this.currentView = "library";
        this.openingBook = false;
        this.viewTransitionInFlight = false;
        this.readerReloadInFlight = false;
        this.readerReloadQueued = false;
        this.readerReloadLastSignature = "";
        this.readerReloadLastAt = 0;
        this.readerOpenedAt = 0;
        this.readerSearchStateByTitle = new Map();

        inputManager.addListener("mousedown", this.onMouseDown.bind(this));
        inputManager.addListener("keydown", this.onGlobalKeyDown.bind(this));
    }

    normalizeHexColor(color, fallback = "#000000") {
        const candidate = String(color || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(candidate)) {
            return candidate.toLowerCase();
        }
        if (/^#[0-9a-f]{3}$/i.test(candidate)) {
            const [, r, g, b] = candidate;
            return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
        }
        const rgbMatch = candidate.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
        if (rgbMatch) {
            const [r, g, b] = rgbMatch.slice(1, 4).map(value => {
                const num = Number(value);
                return Math.max(0, Math.min(255, num));
            });
            return `#${[r, g, b].map(value => value.toString(16).padStart(2, "0")).join("")}`;
        }
        return this.normalizeHexColor(fallback === color ? "#000000" : fallback, "#000000");
    }

    hexToRgb(hexColor) {
        const normalized = this.normalizeHexColor(hexColor, "#000000");
        return {
            r: parseInt(normalized.slice(1, 3), 16),
            g: parseInt(normalized.slice(3, 5), 16),
            b: parseInt(normalized.slice(5, 7), 16)
        };
    }

    hexLuminance(hexColor) {
        const { r, g, b } = this.hexToRgb(hexColor);
        const toLinear = channel => {
            const normalized = channel / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }

    hexContrastRatio(colorA, colorB) {
        const luminanceA = this.hexLuminance(colorA);
        const luminanceB = this.hexLuminance(colorB);
        const lighter = Math.max(luminanceA, luminanceB);
        const darker = Math.min(luminanceA, luminanceB);
        return (lighter + 0.05) / (darker + 0.05);
    }

    resolveAccessibleColorPair(foregroundColor, backgroundColor, fallbackForeground = "#000000", minContrast = 4.5) {
        const background = this.normalizeHexColor(backgroundColor, "#ffffff");
        const requestedForeground = this.normalizeHexColor(foregroundColor, fallbackForeground);
        if (this.hexContrastRatio(requestedForeground, background) >= minContrast) {
            return requestedForeground;
        }
        const fallback = this.normalizeHexColor(fallbackForeground, "#000000");
        const candidates = [requestedForeground, fallback, "#000000", "#ffffff"]
            .filter((value, index, array) => array.indexOf(value) === index);
        let best = candidates[0];
        let bestContrast = 0;
        candidates.forEach(candidate => {
            const contrast = this.hexContrastRatio(candidate, background);
            if (contrast > bestContrast) {
                bestContrast = contrast;
                best = candidate;
            }
        });
        return best;
    }

    mixHex(colorA, colorB, weight = 0.5) {
        const a = this.hexToRgb(colorA);
        const b = this.hexToRgb(colorB);
        const ratio = Math.max(0, Math.min(1, Number(weight)));
        const mixChannel = (first, second) => Math.round(first + (second - first) * ratio);
        return `#${[
            mixChannel(a.r, b.r),
            mixChannel(a.g, b.g),
            mixChannel(a.b, b.b)
        ].map(value => value.toString(16).padStart(2, "0")).join("")}`;
    }

    getCssVarHex(name, fallback) {
        const root = document.documentElement;
        if (!root) {
            return this.normalizeHexColor(fallback, "#000000");
        }
        return this.normalizeHexColor(getComputedStyle(root).getPropertyValue(name), fallback);
    }

	getDefaultInterfaceTextColor(themeMode = "light") {
		return String(themeMode || "light").toLowerCase() === "dark" ? "#ffffff" : "#000000";
	}

	getDefaultMainMenuTextColor(interfaceText = "#ffffff") {
		return this.normalizeHexColor(interfaceText, "#ffffff");
	}

	getThemePalette(theme = "light") {
		switch (String(theme || "light").toLowerCase()) {
			case "dark":
				return {
					theme: "dark",
					themeMode: "dark",
					readerBackground: "#000000",
					readerText: "#ffffff",
					interfaceBackground: "#000000",
					interfaceText: "#ffffff",
					mainMenuBackground: "#000000",
					mainMenuText: "#ffffff"
				};
			case "sepia":
				return {
					theme: "sepia",
					themeMode: "light",
					readerBackground: "#e9dcc6",
					readerText: "#6f4e37",
					interfaceBackground: "#f3e7d3",
					interfaceText: "#5f4634",
					mainMenuBackground: "#ede0ca",
					mainMenuText: "#5f4634"
				};
			case "aurora":
				return {
					theme: "aurora",
					themeMode: "dark",
					readerBackground: "#3b1b49",
					readerText: "#f5ecff",
					interfaceBackground: "#24112f",
					interfaceText: "#f5ecff",
					mainMenuBackground: "#2b1538",
					mainMenuText: "#f5ecff"
				};
			default:
				return {
					theme: "light",
					themeMode: "light",
					readerBackground: "#ffffff",
					readerText: "#000000",
					interfaceBackground: "#ffffff",
					interfaceText: "#000000",
					mainMenuBackground: "#ffffff",
					mainMenuText: "#000000"
				};
		}
	}

    async applyInterfaceColorFromSettings() {
        const root = document.documentElement;
        if (!root) {
            return;
        }

        const storedTheme = (await reader.store.loadSetting("theme")) || null;
        const themeMode = (await reader.store.loadSetting("themeMode")) || "light";
        const currentTheme = storedTheme || (themeMode === "dark" ? "dark" : "light");
        const interfaceColor = this.normalizeHexColor(
            await reader.store.loadSetting("interfaceColor"),
            this.getCssVarHex("--interface-bg", "#1877f2")
        );
		const themePalette = this.getThemePalette(currentTheme);
		const interfaceBackgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("interfaceBackgroundColor"),
			themePalette.interfaceBackground
		);
		const interfaceTextColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("interfaceTextColor"),
			interfaceBackgroundColor,
			themePalette.interfaceText
		);
		const mainMenuBackgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("mainMenuBackgroundColor"),
			themePalette.mainMenuBackground
		);
		const mainMenuTextColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("mainMenuTextColor"),
			mainMenuBackgroundColor,
			themePalette.mainMenuText
		);
		const resolvedInterfaceColor = this.resolveAccessibleColorPair(
			interfaceColor,
			mainMenuBackgroundColor,
			"#1877f2",
			3
		);

        root.style.setProperty("--interface-bg", resolvedInterfaceColor);
        root.style.setProperty("--interface-bg-mid", this.mixHex(resolvedInterfaceColor, "#000000", 0.2));
        root.style.setProperty("--interface-text", interfaceTextColor);
        root.style.setProperty("--interface-text-muted", this.mixHex(interfaceTextColor, interfaceBackgroundColor, 0.35));
        root.style.setProperty("--interface-card-bg", this.mixHex(resolvedInterfaceColor, "#ffffff", 0.88));
        root.style.setProperty("--interface-card-text", interfaceTextColor);
        root.style.setProperty("--interface-hover", this.mixHex(resolvedInterfaceColor, interfaceBackgroundColor, 0.25));
        root.style.setProperty("--interface-hover-light-1", this.mixHex(resolvedInterfaceColor, "#ffffff", 0.22));
        root.style.setProperty("--interface-hover-light-2", this.mixHex(resolvedInterfaceColor, "#ffffff", 0.38));
        root.style.setProperty("--interface-selected-bg", resolvedInterfaceColor);
        root.style.setProperty("--interface-selected-text", mainMenuTextColor);
        root.style.setProperty("--app-bg", interfaceBackgroundColor);
        root.style.setProperty("--app-bg-mid", this.mixHex(interfaceBackgroundColor, "#000000", 0.08));
        root.style.setProperty("--sidebar-background", mainMenuBackgroundColor);
        root.style.setProperty("--sidebar-border", this.mixHex(mainMenuBackgroundColor, "#000000", 0.3));
        root.style.setProperty("--main-menu-bg", mainMenuBackgroundColor);
        root.style.setProperty("--main-menu-bg-mid", this.mixHex(mainMenuBackgroundColor, "#000000", 0.08));
        root.style.setProperty("--main-menu-text", mainMenuTextColor);
    }

    resetContainer() {
        window.clearInterval(this.translationJobsRefreshTimer);
        this.container.clear();
        this.container.innerHTML = `
			<input style="display: none" type="file" accept=".epub" id="fileInput" multiple>
			<input style="display: none" type="file" accept=".csv" id="csvInput">
			<input style="display: none" type="file" accept=".json,application/json" id="libraryBackupInput">
			<div class="mainHolder">
				<div class="navigationBar">
					<div class="navigationBarTitle"><img src="assets/logo.png" draggable="false"><span>Leitor de epub Coentro</span></div>
					<div class="navigationBarItem ${this.currentView === "library" ? "currentNavItem" : ""}" id="navLibrary">Biblioteca</div>
					<div class="navigationBarItem ${this.currentView === "zlib" ? "currentNavItem" : ""}" id="navZLib">Projeto Z-Library</div>
					<div class="navigationBarItem ${this.currentView === "translations" ? "currentNavItem" : ""}" id="navTranslations">Traduções</div>
					<div class="navigationBarItem ${this.currentView === "trackers" ? "currentNavItem" : ""}" id="navTrackers">Daily Trackers</div>
					<div class="navigationBarItem ${this.currentView === "settings" ? "currentNavItem" : ""}" id="navSettings">Configurações</div>
					<div class="navigationBarItem ${this.currentView === "shortcuts" ? "currentNavItem" : ""}" id="navShortcuts">Atalhos</div>
					<div class="navigationBarItem ${this.currentView === "about" ? "currentNavItem" : ""}" id="navAbout">Sobre</div>
					<div class="navigationBarItem ${this.currentView === "regexHelp" ? "currentNavItem" : ""}" id="navRegexHelp">Explicação das Regex</div>
				</div>
				<div class="container"></div>

				
					</div>
				</div>
			</div>
		`;

        reader.util.loadElem("#navLibrary").addEventListener("click", () => {
            if (this.currentView !== "library") {
                this.createLibrary();
            }
        });

        reader.util.loadElem("#navZLib").addEventListener("click", () => {
            if (this.currentView !== "zlib") {
                this.createZLib();
            }
        });

        reader.util.loadElem("#navTranslations").addEventListener("click", () => {
            if (this.currentView !== "translations") {
                this.createTranslations();
            }
        });

        reader.util.loadElem("#navTrackers").addEventListener("click", () => {
            if (this.currentView !== "trackers") {
                this.createDailyTrackers();
            }
        });

        reader.util.loadElem("#navSettings").addEventListener("click", () => {
            if (this.currentView !== "settings") {
                this.createSettings();
            }
        });

        reader.util.loadElem("#navShortcuts").addEventListener("click", () => {
            if (this.currentView !== "shortcuts") {
                this.createShortcuts();
            }
        });

        reader.util.loadElem("#navAbout").addEventListener("click", () => {
            if (this.currentView !== "about") {
                this.createAbout();
            }
        });

        reader.util.loadElem("#navRegexHelp").addEventListener("click", () => {
            if (this.currentView !== "regexHelp") {
                this.createRegexHelp();
            }
        });
    }

    async createLibrary() {
        this.currentView = "library";
        await reader.renderer.close();
        reader.util.setTitle("Sua Biblioteca - Leitor de epub Coentro");

        this.resetContainer();

        const container = reader.util.loadElem(".container");
        container.innerHTML = `
			<div class="libraryControlsHolder">
				<div class="libraryControlsSection">
					<div class="librarySearchInputHolder">
						<img src="assets/browse.png" class="librarySearchInputIcon" draggable="false">
						<input class="librarySearchInput" placeholder="Pesquisar livros...">
					</div>
				</div>
				<div class="libraryControlsSection">
					<button class="buttonIcon" id="libraryLayoutButton"><img src="assets/${this.libraryFormat === "grid" ? "list" : "grid"}.png" class="buttonIconImage"></button>
					<button id="addButton"><img src="assets/plus.png" class="buttonIconImage">&nbsp;&nbsp;Adicionar livro</button>
					<button id="exportLibraryButton">Exportar biblioteca</button>
					<button id="importLibraryButton">Importar biblioteca</button>
					<button id="resetLibraryButton">Zerar biblioteca</button>
				</div>
			</div>
			<div class="libraryBooksHolder"></div>
		`;

        const searchInput = reader.util.loadElem(".librarySearchInput");
        searchInput.addEventListener("input", () => {
            this.librarySearchTerm = searchInput.value;
            this.renderBooks();
        });

        reader.util.loadElem("#libraryLayoutButton").addEventListener("click", () => {
            this.libraryFormat = this.libraryFormat === "list" ? "grid" : "list";
            this.createLibrary();
        });

        const fileInput = reader.util.loadElem("#fileInput");
        fileInput.addEventListener("change", async () => {
            await this.addBook(fileInput);
        });

        const addButton = reader.util.loadElem("#addButton");
        addButton.addEventListener("click", () => fileInput.click());

        const exportLibraryButton = reader.util.loadElem("#exportLibraryButton");
        exportLibraryButton.addEventListener("click", () => this.exportLibraryBackup());

        const libraryBackupInput = reader.util.loadElem("#libraryBackupInput");
        libraryBackupInput.addEventListener("change", async () => {
            await this.importLibraryBackup(libraryBackupInput);
            libraryBackupInput.value = "";
        });

        const importLibraryButton = reader.util.loadElem("#importLibraryButton");
        importLibraryButton.addEventListener("click", () => libraryBackupInput.click());

        const resetLibraryButton = reader.util.loadElem("#resetLibraryButton");
        resetLibraryButton.addEventListener("click", () => this.resetLibraryToDefault());

        await this.renderBooks();
    }

    async renderBooks() {
        if (this.currentlyRendering) {
            return;
        }
        this.currentlyRendering = true;
        const container = reader.util.loadElem(".libraryBooksHolder");

        try {
            if (!container) {
                return;
            }

            container.classList.toggle("libraryGridBooksHolder", this.libraryFormat === "grid");

            const books = ((await reader.store.loadLibrary()) || []).filter(book => book && book.title);
            const statuses = (await reader.store.loadBookStatuses()) || {};
            let library = this.sortBooks(this.filterBooks(books));

            const bookOrder = await reader.store.loadBookOrder();
            if (bookOrder && this.libraryFormat === "grid") {
                const orderMap = new Map();
                library.forEach((book, index) => {
                    orderMap.set(book.title, index);
                });

                const orderedLibrary = [];
                const unorderedBooks = [];
                bookOrder.forEach(title => {
                    const index = orderMap.get(title);
                    if (index !== undefined) {
                        orderedLibrary.push(library[index]);
                    }
                });
                library.forEach(book => {
                    if (!bookOrder.includes(book.title)) {
                        unorderedBooks.push(book);
                    }
                });
                library = [...orderedLibrary, ...unorderedBooks];
            }

            const readBooks = [];
            const unreadBooks = [];
            library.forEach(book => {
                if (statuses[book.title] === "read") {
                    readBooks.push(book);
                } else {
                    unreadBooks.push(book);
                }
            });
            library = [...unreadBooks, ...readBooks];

            let allHTML = "";

            for (const item of library) {
                const position = (await reader.store.loadPosition(item.title)) || {};
                const percentage = this.parsePercentage(position.percentage);
                const status = statuses[item.title] || null;
                const statusButton = this.getGoodreadsButtonHtml(item.title, status);
                const isCompletedByProgress = percentage >= 95;
                const isCompleted = isCompletedByProgress || status === "read";
                let completionFlag = "";
                if (isCompleted) {
                    completionFlag = status === "read" && !isCompletedByProgress
                        ? '<button class="completionFlag completionFlagButton" type="button" title="Conclu?do: clique para ajustar"><img class="completionFlagImage" src="assets/yellow_finish_flag_when_returning_pages.png" alt="Retomada ap?s conclus?o"></button>'
                        : '<button class="completionFlag completionFlagButton" type="button" title="Conclu?do: clique para ajustar"><img class="completionFlagImage" src="assets/white_finish_flag_when_returning_pages.png" alt="Leitura conclu?da"></button>';
                }
                const coverStatusGroup = (statusButton || completionFlag)
                    ? `<div class="coverStatusGroup">${statusButton}${completionFlag}</div>`
                    : "";

                const author = item?.attributes?.["Creator"] || "Desconhecido";
                const cover = item?.cover || "";
                const size = Number(item?.size) || 0;
                const bookElemClass = this.libraryFormat === "list" ? "libraryItem" : "libraryGridItem";
                let itemHTML = "";
                const bookIndex = library.indexOf(item);
                const podiumCrown = bookIndex === 0
                    ? '<img class="podium-crown" src="assets/1st-royal-crown.png" alt="">'
                    : "";
                const lastBookLantern = bookIndex === library.length - 1
                    ? '<img class="bookPagesLantern" src="assets/lantern.png" alt="" style="position:absolute; right:10px; bottom:10px; width:24px; height:24px; z-index:4;">'
                    : "";

                if (this.libraryFormat === "list") {
                    const lastOpened = item.lastOpened ? new Date(item.lastOpened)
                        .toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" }) : "&mdash;";
                    const readOverlay = status === "read" ? '<div class="readBookOverlay"></div>' : "";

                    itemHTML = `
                    <div class="libraryImage">
                        <img src="${cover}" draggable="false">
                        ${readOverlay}
                        ${podiumCrown}
                        ${lastBookLantern}
                        ${coverStatusGroup}
                    </div>
                    <div class="libraryTitle"><span>${item.title}</span></div>
                    <div class="libraryAuthor"><span>${author}</span></div>
                    <div class="librarySize">${this.getLength(size)}</div>
                    <div class="libraryProgress">${Math.round(percentage)}%</div>
                    <div class="libraryOpened"><span>${lastOpened}</span></div>
                    <div class="libraryProgressBar">
                        <div class="libraryProgressBarInside" style="width: ${Math.round(percentage * 100) / 100}%;"></div>
                    </div>
                `;
                } else {
                    const readOverlay = status === "read" ? '<div class="readBookOverlay"></div>' : "";
                    itemHTML = `
                    <div class="libraryGridImage">
                        <img src="${cover}" draggable="false">
                        ${readOverlay}
                        ${podiumCrown}
                        ${lastBookLantern}
                        ${coverStatusGroup}
                    </div>
                    <div class="libraryGridTitle"><span>${item.title}</span></div>
                    <div class="libraryGridAuthor"><span>${author}</span></div>
                    <div class="libraryGridProgress"><span>${Math.round(percentage)}% conclu?do</span></div>
                    <div class="libraryProgressBar">
                        <div class="libraryProgressBarInside" style="width: ${Math.round(percentage * 100) / 100}%;"></div>
                    </div>
                `;
                }

                const podiumText = bookIndex === 0 ? "1st" : bookIndex === 1 ? "2nd" : bookIndex === 2 ? "3rd" : "";
                const podiumLabel = (bookIndex < 3 && this.libraryFormat === "grid") ? `<div class="podiumLabel podium-${bookIndex + 1}">${podiumText}</div>` : "";
                const draggableAttr = this.libraryFormat === "grid" ? 'draggable="true"' : "";
                const draggableClass = this.libraryFormat === "grid" ? "draggable-book" : "";
                const bookStatus = status || "want";
                allHTML += `
                <div class="${bookElemClass} libaryElement ${draggableClass}" 
                     title="${item.title}" 
                     data-book-title="${item.title}"
                     data-book-index="${bookIndex}"
                     data-book-status="${bookStatus}"
                     ${draggableAttr}>
                    ${podiumLabel}
                    ${itemHTML}
                </div>
            `;
            }

            if (library.length === 0) {
                allHTML = `
                <div class="libraryItem libraryEmpty">
                    <div class="libraryEmptyText">Sua biblioteca est? vazia. Adicione um livro para come?ar.</div>
                </div>
            `;
            }

            if (this.libraryFormat === "list") {
                allHTML = `
                <div class="libraryItem libraryHeader">
                    <div class="libraryImage"></div>
                    <div class="libraryTitle">T?tulo
                        ${this.libraryFilter === "title" ? `<img src="assets/up-arrow.png" class="librarySortIcon icon${this.libraryDescending}">` : ""}
                    </div>
                    <div class="libraryAuthor">Autor
                        ${this.libraryFilter === "author" ? `<img src="assets/up-arrow.png" class="librarySortIcon icon${this.libraryDescending}">` : ""}
                    </div>
                    <div class="librarySize">Tamanho
                        ${this.libraryFilter === "size" ? `<img src="assets/up-arrow.png" class="librarySortIcon icon${this.libraryDescending}">` : ""}
                    </div>
                    <div class="libraryProgress">Progresso</div>
                    <div class="libraryOpened">?ltima abertura
                        ${this.libraryFilter === "last-opened" ? `<img src="assets/up-arrow.png" class="librarySortIcon icon${this.libraryDescending}">` : ""}
                    </div>
                </div>
            ` + allHTML;
            }

            container.innerHTML = allHTML;

            reader.util.loadAllElems(".libaryElement").forEach(elem => {
                elem.addEventListener("click", () => this.loadBook(elem.getAttribute("data-book-title") || elem.title));
                elem.addEventListener("contextmenu", event => {
                    if (event.button !== 2 || event.buttons !== 2) {
                        return;
                    }
                    event.preventDefault();
                    this.openBookContextMenu(event, elem.getAttribute("data-book-title") || elem.title);
                });
            });

            if (this.libraryFormat === "grid") {
                this.setupDragAndDrop();
            }

            reader.util.loadAllElems(".goodreadsButton").forEach(elem => {
                elem.addEventListener("click", async event => {
                    event.stopPropagation();
                    const title = elem.getAttribute("data-title");
                    const book = await reader.store.loadBook(title);
                    window.open(reader.util.getGoodreadsUrl(book), "_blank");
                });
            });

            reader.util.loadAllElems(".completionFlagButton").forEach(elem => {
                elem.addEventListener("click", async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const bookElem = event.target && event.target.closest ? event.target.closest(".libaryElement") : null;
                    const title = bookElem?.dataset?.bookTitle || bookElem?.title || "";
                    if (!title) {
                        return;
                    }
                    await this.handleCompletionFlagAction(title);
                });
            });

            if (this.libraryFormat === "list") {
                reader.util.loadElem(".libraryTitle")?.addEventListener("click", () => {
                    this.libraryDescending = this.libraryFilter === "title" ? !this.libraryDescending : true;
                    this.libraryFilter = "title";
                    this.renderBooks();
                });

                reader.util.loadElem(".libraryAuthor")?.addEventListener("click", () => {
                    this.libraryDescending = this.libraryFilter === "author" ? !this.libraryDescending : true;
                    this.libraryFilter = "author";
                    this.renderBooks();
                });

                reader.util.loadElem(".librarySize")?.addEventListener("click", () => {
                    this.libraryDescending = this.libraryFilter === "size" ? !this.libraryDescending : true;
                    this.libraryFilter = "size";
                    this.renderBooks();
                });

                reader.util.loadElem(".libraryOpened")?.addEventListener("click", () => {
                    this.libraryDescending = this.libraryFilter === "last-opened" ? !this.libraryDescending : true;
                    this.libraryFilter = "last-opened";
                    this.renderBooks();
                });
            }
        } catch (error) {
            console.error("Erro ao renderizar biblioteca.", error);
            if (container) {
                const reason = error && error.message ? String(error.message) : String(error || "erro interno");
                container.innerHTML = `
                <div class="libraryItem libraryEmpty">
                    <div class="libraryEmptyText">Erro ao carregar a biblioteca: ${reason}</div>
                </div>
            `;
            }
        } finally {
            this.currentlyRendering = false;
        }
    }

    getGoodreadsLabel(status) {
        switch (status) {
            case "want":
                return "Want to read";
            case "reading":
                return "Reading";
            case "read":
                return "Read";
            default:
                return null;
        }
    }

    getGoodreadsButtonHtml(title, status) {
        const label = this.getGoodreadsLabel(status);
        if (!label) {
            return "";
        }
        return `<button class="goodreadsButton goodreads-${status}" data-title="${title}">${label}</button>`;
    }

    openBookContextMenu(event, title) {
        reader.util.loadAllElems(".contextMenu").forEach(elem => elem.remove());
        const contextMenu = reader.util.createElement("div", this.container, "contextMenu");

        contextMenu.innerHTML = `
			<div class="contextMenuTitle">${title}</div>
			<div class="contextMenuItem" id="contextMenuOpen">Abrir</div>
			<div class="contextMenuItem" id="contextMenuDetails">Detalhes</div>
			<div class="contextMenuItem contextMenuDelete" id="contextMenuDelete">Excluir</div>
		`;

        contextMenu.style.left = `${event.clientX}px`;
        if (event.clientY + contextMenu.clientHeight > window.innerHeight) {
            contextMenu.style.top = `${event.clientY - contextMenu.clientHeight}px`;
        } else {
            contextMenu.style.top = `${event.clientY}px`;
        }

        contextMenu.addEventListener("click", event => {
            if (!event.target.classList.contains("contextMenuItem")) {
                return;
            }

            if (event.target.id === "contextMenuOpen") {
                this.loadBook(title);
            }

            if (event.target.id === "contextMenuDetails") {
                this.openInfoBox(title);
            }

            if (event.target.id === "contextMenuDelete") {
                this.openDeleteDialog(title);
            }

            contextMenu.remove();
        });
    }

    onMouseDown(event) {
        if (this.currentView !== "library") {
            return;
        }

        if (!event.target.className.includes("contextMenu")) {
            reader.util.loadAllElems(".contextMenu").forEach(elem => elem.remove());
        }
    }

    async onGlobalKeyDown(event) {
        const target = event.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        const key = event.key.toLowerCase();
        if (this.viewTransitionInFlight && (key === "c" || key === "t")) {
            event.preventDefault();
            return;
        }

        if (key === "c") {
            if (this.currentView !== "library") {
                event.preventDefault();
                this.viewTransitionInFlight = true;
                try {
                    await this.createLibrary();
                } finally {
                    this.viewTransitionInFlight = false;
                }
            }
            return;
        }

        if (key === "t") {
            if (this.currentView !== "reader") {
                event.preventDefault();
                this.viewTransitionInFlight = true;
                try {
                    await this.resumeLastBook();
                } finally {
                    this.viewTransitionInFlight = false;
                }
            }
        }
    }

    async resumeLastBook() {
        const library = await reader.store.loadLibrary();
        if (!library || !library.length) {
            return;
        }

        let last = library[0];
        for (const item of library) {
            if ((item.lastOpened || 0) > (last.lastOpened || 0)) {
                last = item;
            }
        }

        if (!last || !last.title) {
            return;
        }

        this.loadBook(last.title);
    }

    filterBooks(books) {
        const searchTerm = this.librarySearchTerm.toLowerCase();
        return books.filter(book => book.title.toLowerCase().includes(searchTerm));
    }

    parsePercentage(value) {
        const normalized = typeof value === "number"
            ? value
            : parseFloat(String(value ?? "0").replace(",", "."));
        if (!Number.isFinite(normalized)) {
            return 0;
        }
        return Math.max(0, Math.min(100, normalized));
    }

    sortBooks(books) {
        switch (this.libraryFilter) {
            case "last-opened":
                books.sort((a, b) => {
                    const openedA = a.lastOpened || 0;
                    const openedB = b.lastOpened || 0;
                    return this.libraryDescending ? openedB - openedA : openedA - openedB;
                });
                break;
            case "title":
                books.sort((a, b) => this.libraryDescending ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title));
                break;
            case "author":
                books.sort((a, b) => {
                    const authorA = a.attributes["Creator"] || "Unknown";
                    const authorB = b.attributes["Creator"] || "Unknown";
                    return this.libraryDescending ? authorB.localeCompare(authorA) : authorA.localeCompare(authorB);
                });
                break;
            case "size":
                books.sort((a, b) => this.libraryDescending ? b.size - a.size : a.size - b.size);
                break;
        }

        return books;
    }

    async createZLib(search = "", filters = {}) {
        this.currentView = "zlib";
        this.resetContainer();
        reader.util.setTitle("Projeto Z-Library - Leitor de epub Coentro");

        // Load saved filters from storage
        const savedFilters = await reader.store.get("zlibFilters") || {};
        const currentFilters = { ...savedFilters, ...filters };

        const container = reader.util.loadElem(".container");
        const zlib = reader.zlib || new ZLib();
        const languages = zlib.getLanguages();
        const extensions = zlib.getExtensions();
        const contentTypes = zlib.getContentTypes();

        // Generate year options
        const currentYear = new Date().getFullYear();
        const years = [];
        for (let year = currentYear; year >= 1900; year--) {
            years.push(year);
        }

        container.innerHTML = `
			<div class="zlibControlsHolder">
				<div class="zlibSearchSection">
					<div class="librarySearchInputHolder">
						<img src="assets/browse.png" class="librarySearchInputIcon" draggable="false">
						<input class="librarySearchInput" id="zlibSearchInput" placeholder="Pesquisar no Z-Library..." value="${search}">
					</div>
					<button id="zlibSearchButton">Pesquisar</button>
				</div>
				<div class="zlibFiltersSection">
					<div class="zlibFilterGroup">
						<label>Year From:</label>
						<select id="zlibYearFrom" class="zlibFilterSelect">
							<option value="">Any</option>
							${years.map(year => `<option value="${year}" ${currentFilters.yearFrom == year ? "selected" : ""}>${year}</option>`).join("")}
						</select>
			</div>
					<div class="zlibFilterGroup">
						<label>Year To:</label>
						<select id="zlibYearTo" class="zlibFilterSelect">
							<option value="">Any</option>
							${years.map(year => `<option value="${year}" ${currentFilters.yearTo == year ? "selected" : ""}>${year}</option>`).join("")}
						</select>
				</div>
					<div class="zlibFilterGroup">
						<label>Language:</label>
						<select id="zlibLanguage" class="zlibFilterSelect">
							${languages.map(lang => `<option value="${lang}" ${currentFilters.language === lang ? "selected" : ""}>${lang}</option>`).join("")}
						</select>
				</div>
					<div class="zlibFilterGroup">
						<label>Extension:</label>
						<select id="zlibExtension" class="zlibFilterSelect">
							${extensions.map(ext => `<option value="${ext}" ${currentFilters.extension === ext ? "selected" : ""}>${ext}</option>`).join("")}
						</select>
				</div>
					<div class="zlibFilterGroup">
						<label>Type:</label>
						<select id="zlibType" class="zlibFilterSelect">
							${contentTypes.map(type => `<option value="${type}" ${currentFilters.type === type ? "selected" : ""}>${type}</option>`).join("")}
						</select>
					</div>
					<button id="zlibSaveFilters" class="zlibSaveButton" title="Salvar filtros">
						💾
					</button>
				</div>
			</div>
			<div class="zlibSearchResults">
				<div class="zlibIframeHeader">
					<span class="zlibIframeTitle">Resultados da Busca</span>
				</div>
				<div class="zlibResultsContainer" id="zlibSearchContainer">
					<div class="zlibLoadingState" id="zlibLoadingState" style="display: none;">
						<div class="zlibSpinner"></div>
						<p>Buscando resultados...</p>
					</div>
					<div class="zlibResultsList" id="zlibResultsList"></div>
					<div class="zlibIframePlaceholder" id="zlibPlaceholder">
						<p>Digite uma pesquisa acima e clique em "Pesquisar" para gerar o link de busca do Z-Library.</p>
						<p class="zlibIframeNote" style="margin-top: 10px; font-size: 0.9em; color: #666;">
							ℹ️ Devido à proteção Cloudflare do Z-Library, não é possível fazer buscas diretas. Use o link gerado para acessar os resultados no navegador.
						</p>
					</div>
				</div>
			</div>
		`;

        const searchButton = reader.util.loadElem("#zlibSearchButton");
        const searchInput = reader.util.loadElem("#zlibSearchInput");
        const saveFiltersButton = reader.util.loadElem("#zlibSaveFilters");

        const placeholderIntro = reader.util.loadElem("#zlibPlaceholder > p");
        if (placeholderIntro) {
            placeholderIntro.textContent = 'Digite uma pesquisa acima e clique em "Pesquisar" para buscar resultados no Z-Library.';
        }
        const legacyCloudflareNote = reader.util.loadElem("#zlibPlaceholder .zlibIframeNote");
        if (legacyCloudflareNote) {
            legacyCloudflareNote.remove();
        }

        const renderSearchActions = (searchUrl, mountNode) => {
            if (!mountNode || !searchUrl) return;

            const actionsWrapper = document.createElement("div");
            actionsWrapper.style.marginTop = "16px";
            actionsWrapper.style.display = "flex";
            actionsWrapper.style.gap = "12px";
            actionsWrapper.style.justifyContent = "center";
            actionsWrapper.style.flexWrap = "wrap";

            const copyBtn = document.createElement("button");
            copyBtn.textContent = "Copiar Link";
            copyBtn.style.padding = "12px 24px";
            copyBtn.style.background = "linear-gradient(135deg, rgba(255, 140, 66, 0.9), rgba(255, 107, 53, 0.9))";
            copyBtn.style.color = "white";
            copyBtn.style.border = "none";
            copyBtn.style.borderRadius = "8px";
            copyBtn.style.cursor = "pointer";
            copyBtn.style.fontWeight = "bold";
            copyBtn.style.boxShadow = "0 2px 8px rgba(255, 140, 66, 0.3)";
            copyBtn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(searchUrl);
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = "Copiado!";
                    copyBtn.style.background = "linear-gradient(135deg, rgba(70, 150, 70, 0.9), rgba(60, 140, 60, 0.9))";
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                        copyBtn.style.background = "linear-gradient(135deg, rgba(255, 140, 66, 0.9), rgba(255, 107, 53, 0.9))";
                    }, 1500);
                } catch (error) {
                    console.error("Failed to copy URL:", error);
                }
            });

            const openLink = document.createElement("a");
            openLink.href = searchUrl;
            openLink.target = "_blank";
            openLink.rel = "noopener noreferrer";
            openLink.textContent = "Abrir no Navegador";
            openLink.style.padding = "12px 24px";
            openLink.style.background = "linear-gradient(135deg, rgba(70, 150, 70, 0.9), rgba(60, 140, 60, 0.9))";
            openLink.style.color = "white";
            openLink.style.border = "none";
            openLink.style.borderRadius = "8px";
            openLink.style.cursor = "pointer";
            openLink.style.fontWeight = "bold";
            openLink.style.textDecoration = "none";
            openLink.style.display = "inline-block";
            openLink.style.boxShadow = "0 2px 8px rgba(70, 150, 70, 0.3)";

            actionsWrapper.appendChild(copyBtn);
            actionsWrapper.appendChild(openLink);
            mountNode.appendChild(actionsWrapper);
        };

        const performSearch = async () => {
            const searchQuery = searchInput.value.trim();
            if (!searchQuery) {
                return;
            }

            const filters = {
                yearFrom: reader.util.loadElem("#zlibYearFrom").value,
                yearTo: reader.util.loadElem("#zlibYearTo").value,
                language: reader.util.loadElem("#zlibLanguage").value,
                extension: reader.util.loadElem("#zlibExtension").value,
                type: reader.util.loadElem("#zlibType").value
            };

            const liveResultsList = reader.util.loadElem("#zlibResultsList");
            const livePlaceholder = reader.util.loadElem("#zlibPlaceholder");
            const liveLoadingState = reader.util.loadElem("#zlibLoadingState");

            if (liveLoadingState) liveLoadingState.style.display = "block";
            if (liveResultsList) liveResultsList.innerHTML = "";
            if (livePlaceholder) {
                livePlaceholder.style.display = "none";
                livePlaceholder.innerHTML = "";
            }

            const response = await zlib.search(searchQuery, filters);
            if (liveLoadingState) liveLoadingState.style.display = "none";
            if (!liveResultsList) return;

            if (response.results && response.results.length > 0) {
                this.renderZLibResults(response.results, liveResultsList, response.searchUrl);
                return;
            }

            const errorText = response.error ? `Motivo: ${response.error}` : "Nenhum resultado encontrado.";
            liveResultsList.innerHTML = `
				<div class="zlibLoadingState" style="display: block;">
					<p>${errorText}</p>
				</div>
			`;
            renderSearchActions(response.searchUrl, liveResultsList);
            return;
            const searchUrl = zlib.buildSearchUrl(searchQuery, filters);

            // Show URL builder result instead of trying to fetch
            const resultsList = reader.util.loadElem("#zlibResultsList");
            const placeholder = reader.util.loadElem("#zlibPlaceholder");
            const loadingState = reader.util.loadElem("#zlibLoadingState");

            if (loadingState) loadingState.style.display = "none";
            if (resultsList) resultsList.innerHTML = "";

            if (placeholder) {
                placeholder.innerHTML = `
					<div style="text-align: center; padding: 40px 20px;">
						<div style="margin-bottom: 30px;">
							<h2 style="color: #333; margin-bottom: 15px;">🔒 Proteção Cloudflare</h2>
							<p style="color: #666; line-height: 1.6; max-width: 600px; margin: 0 auto;">
								O Z-Library usa proteção Cloudflare que impede buscas diretas através de extensões. 
								Use o link abaixo para acessar os resultados diretamente no navegador.
							</p>
						</div>
						
						<div style="background: rgba(255, 255, 255, 0.9); border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
							<p style="font-size: 0.9em; color: #666; margin-bottom: 12px; text-align: left;"><strong>URL de Busca:</strong></p>
							<div style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin-bottom: 15px; word-break: break-all; font-family: monospace; font-size: 0.85em; text-align: left; color: #D4AF37;">
								${searchUrl}
							</div>
							
							<div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
								<button id="zlibCopyUrlBtn" style="padding: 12px 24px; background: linear-gradient(135deg, rgba(255, 140, 66, 0.9), rgba(255, 107, 53, 0.9)); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(255, 140, 66, 0.3);">
									📋 Copiar URL
								</button>
								<a href="${searchUrl}" target="_blank" rel="noopener noreferrer" style="padding: 12px 24px; background: linear-gradient(135deg, rgba(70, 150, 70, 0.9), rgba(60, 140, 60, 0.9)); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(70, 150, 70, 0.3);">
									🔗 Abrir no Navegador
								</a>
							</div>
						</div>
						
						<p style="margin-top: 30px; font-size: 0.85em; color: #999;">
							💡 <strong>Dica:</strong> Após abrir no navegador, você pode copiar os links dos livros e adicioná-los à sua biblioteca.
						</p>
					</div>
				`;
                placeholder.style.display = "block";

                // Add copy functionality
                const copyBtn = reader.util.loadElem("#zlibCopyUrlBtn");
                if (copyBtn) {
                    copyBtn.addEventListener("click", async () => {
                        try {
                            await navigator.clipboard.writeText(searchUrl);
                            const originalText = copyBtn.textContent;
                            copyBtn.textContent = "✓ Copiado!";
                            copyBtn.style.background = "linear-gradient(135deg, rgba(70, 150, 70, 0.9), rgba(60, 140, 60, 0.9))";
                            setTimeout(() => {
                                copyBtn.textContent = originalText;
                                copyBtn.style.background = "linear-gradient(135deg, rgba(255, 140, 66, 0.9), rgba(255, 107, 53, 0.9))";
                            }, 2000);
                        } catch (err) {
                            console.error("Failed to copy:", err);
                            // Fallback: select text
                            const urlDiv = copyBtn.parentElement.previousElementSibling;
                            const range = document.createRange();
                            range.selectNodeContents(urlDiv);
                            const selection = window.getSelection();
                            selection.removeAllRanges();
                            selection.addRange(range);
                        }
                    });
                }
            }
        };

        // Render search results
        this.renderZLibResults = (results, container, searchUrl) => {
            if (!container) return;

            container.innerHTML = `
				<div class="zlibResultsHeader">
					<span class="zlibResultsCount">${results.length} resultado${results.length !== 1 ? 's' : ''} encontrado${results.length !== 1 ? 's' : ''}</span>
				</div>
				<div class="zlibResultsGrid">
					${results.map(result => `
						<div class="zlibResultItem">
							${result.coverUrl ? `<img src="${result.coverUrl}" alt="${result.title}" class="zlibResultCover" onerror="this.style.display='none'">` : '<div class="zlibResultCoverPlaceholder">📚</div>'}
							<div class="zlibResultInfo">
								<h3 class="zlibResultTitle">
									<a href="${result.url}" target="_blank" rel="noopener noreferrer">${result.title}</a>
								</h3>
								<p class="zlibResultAuthor">${result.author}</p>
								<div class="zlibResultMeta">
									${result.year ? `<span class="zlibResultMetaItem">📅 ${result.year}</span>` : ''}
									${result.language ? `<span class="zlibResultMetaItem">🌐 ${result.language}</span>` : ''}
									${result.extension ? `<span class="zlibResultMetaItem">📄 ${result.extension}</span>` : ''}
									${result.size ? `<span class="zlibResultMetaItem">💾 ${result.size}</span>` : ''}
								</div>
								<a href="${result.url}" target="_blank" rel="noopener noreferrer" class="zlibResultLink">Ver no Z-Library ↗</a>
							</div>
						</div>
					`).join("")}
				</div>
			`;
            renderSearchActions(searchUrl, container);
        };

        searchButton.addEventListener("click", performSearch);
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                performSearch();
            }
        });

        // Filter change listeners
        ["zlibYearFrom", "zlibYearTo", "zlibLanguage", "zlibExtension", "zlibType"].forEach(id => {
            reader.util.loadElem(`#${id}`).addEventListener("change", performSearch);
        });

        // Save filters button
        saveFiltersButton.addEventListener("click", async () => {
            const filters = {
                yearFrom: reader.util.loadElem("#zlibYearFrom").value,
                yearTo: reader.util.loadElem("#zlibYearTo").value,
                language: reader.util.loadElem("#zlibLanguage").value,
                extension: reader.util.loadElem("#zlibExtension").value,
                type: reader.util.loadElem("#zlibType").value
            };
            await reader.store.set("zlibFilters", filters);
            saveFiltersButton.style.opacity = "0.5";
            setTimeout(() => {
                saveFiltersButton.style.opacity = "1";
            }, 500);
        });

        // Handle opening in new tab buttons
    }

    async createSettings(container) {
        const isReader = this.currentView === "reader";
        if (!container) {
            this.currentView = "settings";
            this.resetContainer();
            reader.util.setTitle("Configuracoes - Leitor de epub Coentro");
            container = reader.util.loadElem(".container");
        }

        const fontSize = Number(await reader.store.loadSetting("fontSize")) || 16;
        const lineHeight = Number(await reader.store.loadSetting("lineSpacing")) || 1.35;
        const maxWidth = Number(await reader.store.loadSetting("maxWidth")) || 1500;
        const fontFamily = (await reader.store.loadSetting("font")) || "serif";
		const readerSearchFontFamily = String((await reader.store.loadSetting("readerSearchFontFamily")) || "Helvetica, Arial, sans-serif");
		const readerSearchFontSize = Math.max(8, Math.min(24, Number(await reader.store.loadSetting("readerSearchFontSize")) || 16));
		const readerSearchBackgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("readerSearchBackgroundColor"),
			"#adff2f"
		);
		const readerSearchTextColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("readerSearchTextColor"),
			readerSearchBackgroundColor,
			"#ffffff",
			2.5
		);
		const readerSearchWindowWidth = Math.max(420, Math.min(1400, Number(await reader.store.loadSetting("readerSearchWindowWidth")) || 960));
		const readerSearchWindowHeight = Math.max(180, Math.min(720, Number(await reader.store.loadSetting("readerSearchWindowHeight")) || 320));
		const storedTheme = (await reader.store.loadSetting("theme")) || null;
		const themeMode = (await reader.store.loadSetting("themeMode")) || "light";
		const currentTheme = storedTheme || (themeMode === "dark" ? "dark" : "light");
		const themePalette = this.getThemePalette(currentTheme);
		const backgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("backgroundColor"),
			themePalette.readerBackground
		);
		const textColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("textColor"),
			backgroundColor,
			themePalette.readerText
		);
		const interfaceColor = this.normalizeHexColor(await reader.store.loadSetting("interfaceColor"), "#1877f2");
		const interfaceBackgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("interfaceBackgroundColor"),
			themePalette.interfaceBackground
		);
		const interfaceTextColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("interfaceTextColor"),
			interfaceBackgroundColor,
			themePalette.interfaceText
		);
		const mainMenuBackgroundColor = this.normalizeHexColor(
			await reader.store.loadSetting("mainMenuBackgroundColor"),
			themePalette.mainMenuBackground
		);
		const mainMenuTextColor = this.resolveAccessibleColorPair(
			await reader.store.loadSetting("mainMenuTextColor"),
			mainMenuBackgroundColor,
			themePalette.mainMenuText
		);
		const resolvedInterfaceColor = this.resolveAccessibleColorPair(
			interfaceColor,
			mainMenuBackgroundColor,
			"#1877f2",
			3
		);
        const pageViewMode = (await reader.store.loadSetting("pageViewMode")) || "two";
        const readerMargin = Number(await reader.store.loadSetting("readerMargin")) || 50;
        const preferredLanguage = (await reader.store.loadSetting("preferredLanguage")) || "pt";
        let translateBooks = !!(await reader.store.loadSetting("translateBooks"));
        let translationProvider = (await reader.store.loadSetting("translationProvider")) || "google";
        let translationApiKey = (await reader.store.loadSetting("translationApiKey")) || "";
        let translationApiUrl = (await reader.store.loadSetting("translationApiUrl")) || "http://127.0.0.1:8000/translate";
        let translationModel = (await reader.store.loadSetting("translationModel")) || "facebook/nllb-200-distilled-600M";
        let readerShowTranslatedText = (await reader.store.loadSetting("readerShowTranslatedText")) !== false;
        let hideOceanPdfWatermark = !!(await reader.store.loadSetting("hideOceanPdfWatermark"));
        let showNavArrows = !!(await reader.store.loadSetting("showNavArrows"));
        let tapToNavigate = !!(await reader.store.loadSetting("tapToNavigate"));
        let merriamWebsterApiKey = (await reader.store.loadSetting("merriamWebsterApiKey")) || "";

        container.innerHTML = `
			<div class="settingsContainer">
				<div class="settingsSection">
					<div class="settingsSectionTitle">Idioma</div>
					<div class="settingsControlGroup">
						<label for="settingsPreferredLanguage">Idioma da sua preferência</label>
						<div class="settingsSelectWrap settingsSelectLargeWrap" data-no-auto-translate="true">
							<select id="settingsPreferredLanguage" class="settingsSelect settingsSelectLarge">
								<option value="en" ${preferredLanguage === "en" ? "selected" : ""}>English (English)</option>
								<option value="zh" ${preferredLanguage === "zh" ? "selected" : ""}>中文 (Zhongwén, Chinese)</option>
								<option value="hi" ${preferredLanguage === "hi" ? "selected" : ""}>हिन्दी (Hindi)</option>
								<option value="es" ${preferredLanguage === "es" ? "selected" : ""}>Español (Spanish)</option>
								<option value="fr" ${preferredLanguage === "fr" ? "selected" : ""}>Français (French)</option>
								<option value="ar" ${preferredLanguage === "ar" ? "selected" : ""}>العربية (Arabic)</option>
								<option value="bn" ${preferredLanguage === "bn" ? "selected" : ""}>বাংলা (Bengali)</option>
								<option value="pt" ${preferredLanguage === "pt" ? "selected" : ""}>Português (Portuguese)</option>
								<option value="ru" ${preferredLanguage === "ru" ? "selected" : ""}>Русский (Russian)</option>
								<option value="ja" ${preferredLanguage === "ja" ? "selected" : ""}>日本語 (Japanese)</option>
							</select>
							<span class="settingsSelectChevron" aria-hidden="true">▼</span>
						</div>
						<label class="settingsCheckboxLabel" for="settingsTranslateBooks">
							<input id="settingsTranslateBooks" type="checkbox" ${translateBooks ? "checked" : ""}>
							<span>Também traduzir meus livros</span>
						</label>
						<label for="settingsTranslationProvider">Opção de tradução</label>
						<div class="settingsSelectWrap">
							<select id="settingsTranslationProvider" class="settingsSelect">
								<option value="google" ${translationProvider === "google" ? "selected" : ""}>Google Tradutor</option>
								<option value="hf-selfhost" ${translationProvider === "hf-selfhost" ? "selected" : ""}>Hugging Face + modelos MT open-source (self-host)</option>
							</select>
							<span class="settingsSelectChevron" aria-hidden="true">▼</span>
						</div>
						<label class="settingsCheckboxLabel" for="settingsReaderShowTranslatedText">
							<input id="settingsReaderShowTranslatedText" type="checkbox" ${readerShowTranslatedText ? "checked" : ""}>
							<span>Mostrar versão traduzida no leitor</span>
						</label>
						<label class="settingsCheckboxLabel" for="settingsHideOceanPdfWatermark">
							<input id="settingsHideOceanPdfWatermark" type="checkbox" ${hideOceanPdfWatermark ? "checked" : ""}>
							<span>Sumir com marca-d'água do Ocean of Pdf</span>
						</label>
						<div id="settingsHFSelfHostFields" ${translationProvider === "hf-selfhost" ? "" : "hidden"}>
							<label for="settingsTranslationApiUrl">URL da API (self-host)</label>
							<input id="settingsTranslationApiUrl" class="settingsTextInput" type="text" value="${translationApiUrl}">
							<label for="settingsTranslationModel">Modelo MT open-source</label>
							<input id="settingsTranslationModel" class="settingsTextInput" type="text" value="${translationModel}">
							<label for="settingsTranslationApiKey">Chave da API (opcional)</label>
							<input id="settingsTranslationApiKey" class="settingsTextInput" type="password" value="${translationApiKey}">
						</div>
					</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Tipografia</div>
					<div class="settingsControlGroup">
						<label for="settingsFontFamily">Familia do texto</label>
						<select id="settingsFontFamily" class="settingsSelect">
							<option value="serif" ${fontFamily === "serif" ? "selected" : ""}>Serif</option>
							<option value="'Georgia', serif" ${fontFamily === "'Georgia', serif" ? "selected" : ""}>Georgia</option>
							<option value="'Palatino Linotype', 'Book Antiqua', Palatino, serif" ${fontFamily === "'Palatino Linotype', 'Book Antiqua', Palatino, serif" ? "selected" : ""}>Palatino</option>
							<option value="'Times New Roman', Times, serif" ${fontFamily === "'Times New Roman', Times, serif" ? "selected" : ""}>Times New Roman</option>
							<option value="sans-serif" ${fontFamily === "sans-serif" ? "selected" : ""}>Sans Serif</option>
							<option value="'Trebuchet MS', sans-serif" ${fontFamily === "'Trebuchet MS', sans-serif" ? "selected" : ""}>Trebuchet</option>
						</select>
					</div>
					<div class="settingsControlGroup">
						<label for="settingsFontSize">Tamanho do texto: <span id="fontSizeNum">${fontSize}px</span></label>
						<input id="settingsFontSize" class="settingsSlider" type="range" min="12" max="64" value="${fontSize}" step="1">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsLineHeight">Espacamento entre linhas: <span id="lineHeightNum">${lineHeight.toFixed(2)}</span></label>
						<input id="settingsLineHeight" class="settingsSlider" type="range" min="1.05" max="3" value="${lineHeight}" step="0.05">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsBackgroundColor">Cor das páginas</label>
						<input id="settingsBackgroundColor" class="settingsColorInput" type="color" value="${backgroundColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsTextColor">Cor do texto dos livros</label>
						<input id="settingsTextColor" class="settingsColorInput" type="color" value="${textColor}">
					</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Tema</div>
					<div class="settingsToggleRow">
						<button class="settingsToggle ${currentTheme === "light" ? "active" : ""}" id="settingsThemeModeLight">Claro</button>
						<button class="settingsToggle ${currentTheme === "dark" ? "active" : ""}" id="settingsThemeModeDark">Escuro</button>
						<button class="settingsToggle ${currentTheme === "sepia" ? "active" : ""}" id="settingsThemeModeSepia">Sepia</button>
						<button class="settingsToggle ${currentTheme === "aurora" ? "active" : ""}" id="settingsThemeModeAurora">Aurora</button>
					</div>
					<div class="settingsControlGroup">
						<label for="settingsInterfaceBackgroundColor">Cor da interface</label>
						<input id="settingsInterfaceBackgroundColor" class="settingsColorInput" type="color" value="${interfaceBackgroundColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsInterfaceTextColor">Cor do texto da interface</label>
						<input id="settingsInterfaceTextColor" class="settingsColorInput" type="color" value="${interfaceTextColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsMainMenuBackgroundColor">Cor de fundo do menu principal</label>
						<input id="settingsMainMenuBackgroundColor" class="settingsColorInput" type="color" value="${mainMenuBackgroundColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsMainMenuTextColor">Cor de texto do menu principal</label>
						<input id="settingsMainMenuTextColor" class="settingsColorInput" type="color" value="${mainMenuTextColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsInterfaceColor">Cor dos botões do menu principal</label>
						<input id="settingsInterfaceColor" class="settingsColorInput" type="color" value="${resolvedInterfaceColor}">
					</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Layout</div>
					<div class="settingsControlGroup">
						<label for="settingsPageView">Visualização de página</label>
						<select id="settingsPageView" class="settingsSelect">
							<option value="one" ${pageViewMode === "one" ? "selected" : ""}>Uma página</option>
							<option value="two" ${pageViewMode === "two" ? "selected" : ""}>Duas páginas</option>
						</select>
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderMargin">Tamanho das margens: <span id="readerMarginNum">${readerMargin}px</span></label>
						<input id="settingsReaderMargin" class="settingsSlider" type="range" min="20" max="100" value="${readerMargin}" step="1">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsMaxWidth">Largura maxima do leitor: <span id="maxWidthNum">${maxWidth}px</span></label>
						<input id="settingsMaxWidth" class="settingsSlider" type="range" min="1000" max="2200" value="${maxWidth}" step="50">
					</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Busca do leitor</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchFontFamily">Fonte da busca</label>
						<select id="settingsReaderSearchFontFamily" class="settingsSelect">
							<option value="Helvetica, Arial, sans-serif" ${readerSearchFontFamily === "Helvetica, Arial, sans-serif" ? "selected" : ""}>Helvetica</option>
							<option value="'Arial', sans-serif" ${readerSearchFontFamily === "'Arial', sans-serif" ? "selected" : ""}>Arial</option>
							<option value="'Trebuchet MS', sans-serif" ${readerSearchFontFamily === "'Trebuchet MS', sans-serif" ? "selected" : ""}>Trebuchet</option>
							<option value="'Verdana', sans-serif" ${readerSearchFontFamily === "'Verdana', sans-serif" ? "selected" : ""}>Verdana</option>
							<option value="'Georgia', serif" ${readerSearchFontFamily === "'Georgia', serif" ? "selected" : ""}>Georgia</option>
						</select>
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchFontSize">Tamanho do texto da busca: <span id="readerSearchFontSizeNum">${readerSearchFontSize}pt</span></label>
						<input id="settingsReaderSearchFontSize" class="settingsSlider" type="range" min="8" max="24" value="${readerSearchFontSize}" step="1">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchBackgroundColor">Cor de fundo da busca</label>
						<input id="settingsReaderSearchBackgroundColor" class="settingsColorInput" type="color" value="${readerSearchBackgroundColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchTextColor">Cor do texto da busca</label>
						<input id="settingsReaderSearchTextColor" class="settingsColorInput" type="color" value="${readerSearchTextColor}">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchWindowWidth">Largura da janela de busca: <span id="readerSearchWindowWidthNum">${readerSearchWindowWidth}px</span></label>
						<input id="settingsReaderSearchWindowWidth" class="settingsSlider" type="range" min="420" max="1400" value="${readerSearchWindowWidth}" step="10">
					</div>
					<div class="settingsControlGroup">
						<label for="settingsReaderSearchWindowHeight">Altura maxima da janela de busca: <span id="readerSearchWindowHeightNum">${readerSearchWindowHeight}px</span></label>
						<input id="settingsReaderSearchWindowHeight" class="settingsSlider" type="range" min="180" max="720" value="${readerSearchWindowHeight}" step="10">
					</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Navegação</div>
					<div class="settingsToggleRow">
						<button class="settingsToggle ${showNavArrows ? "active" : ""}" id="settingsNavArrows">Mostrar setas ao mover o mouse</button>
						<button class="settingsToggle ${tapToNavigate ? "active" : ""}" id="settingsTapNav">Toque para virar pagina</button>
					</div>
					<div class="settingsHint">As setas somem apos 5 segundos sem movimento.</div>
				</div>

				<div class="settingsSection">
					<div class="settingsSectionTitle">Integrações</div>
					<div class="settingsControlGroup">
						<label for="settingsMerriamWebsterApiKey">Chave Merriam-Webster (dicionário)</label>
						<input id="settingsMerriamWebsterApiKey" class="settingsTextInput" type="password" value="${merriamWebsterApiKey}">
					</div>
				</div>
			</div>
		`;

        const refreshReader = () => {
            if (!isReader) {
                return;
            }
            reader.renderer.setNavSettings({
                showNavArrows,
                tapToNavigate
            });
            if (typeof reader.renderer.applyReaderSearchAppearance === "function") {
                void reader.renderer.applyReaderSearchAppearance();
            }
            reader.renderer.onResize(true);
        };

        const preferredLanguageSelect = reader.util.loadElem("#settingsPreferredLanguage");
        preferredLanguageSelect?.addEventListener("change", async () => {
            await reader.store.updateSetting("preferredLanguage", preferredLanguageSelect.value);
            if (this.currentView === "translations") {
                await this.createTranslations();
            }
        });

        const translateBooksInput = reader.util.loadElem("#settingsTranslateBooks");
        translateBooksInput?.addEventListener("change", async () => {
            translateBooks = !!translateBooksInput.checked;
            await reader.store.updateSetting("translateBooks", translateBooks);
            await this.reloadReaderAfterTranslationSettingsChanged();
        });

        const translationProviderSelect = reader.util.loadElem("#settingsTranslationProvider");
        const translationProviderFields = reader.util.loadElem("#settingsHFSelfHostFields");
        translationProviderSelect?.addEventListener("change", async () => {
            translationProvider = translationProviderSelect.value || "google";
            await reader.store.updateSetting("translationProvider", translationProvider);
            if (translationProviderFields) {
                translationProviderFields.hidden = translationProvider !== "hf-selfhost";
            }
            await this.reloadReaderAfterTranslationSettingsChanged();
        });

        const readerShowTranslatedTextInput = reader.util.loadElem("#settingsReaderShowTranslatedText");
        readerShowTranslatedTextInput?.addEventListener("change", async () => {
            readerShowTranslatedText = !!readerShowTranslatedTextInput.checked;
            await reader.store.updateSetting("readerShowTranslatedText", readerShowTranslatedText);
            await this.reloadReaderAfterTranslationSettingsChanged();
        });

        const hideOceanPdfWatermarkInput = reader.util.loadElem("#settingsHideOceanPdfWatermark");
        hideOceanPdfWatermarkInput?.addEventListener("change", async () => {
            hideOceanPdfWatermark = !!hideOceanPdfWatermarkInput.checked;
            await reader.store.updateSetting("hideOceanPdfWatermark", hideOceanPdfWatermark);
            await this.reloadReaderAfterTranslationSettingsChanged();
        });

        const translationApiUrlInput = reader.util.loadElem("#settingsTranslationApiUrl");
        translationApiUrlInput?.addEventListener("change", async () => {
            translationApiUrl = String(translationApiUrlInput.value || "").trim();
            await reader.store.updateSetting("translationApiUrl", translationApiUrl);
        });

        const translationModelInput = reader.util.loadElem("#settingsTranslationModel");
        translationModelInput?.addEventListener("change", async () => {
            translationModel = String(translationModelInput.value || "").trim();
            await reader.store.updateSetting("translationModel", translationModel);
        });

        const translationApiKeyInput = reader.util.loadElem("#settingsTranslationApiKey");
        translationApiKeyInput?.addEventListener("change", async () => {
            translationApiKey = String(translationApiKeyInput.value || "").trim();
            await reader.store.updateSetting("translationApiKey", translationApiKey);
        });

        const fontFamilySelect = reader.util.loadElem("#settingsFontFamily");
        fontFamilySelect.addEventListener("change", async () => {
            await reader.store.updateSetting("font", fontFamilySelect.value);
            refreshReader();
        });

        const fontSizeSlider = reader.util.loadElem("#settingsFontSize");
        fontSizeSlider.addEventListener("input", async () => {
            await reader.store.updateSetting("fontSize", fontSizeSlider.value);
            reader.util.loadElem("#fontSizeNum").innerText = `${fontSizeSlider.value}px`;
            refreshReader();
        });

        const lineHeightSlider = reader.util.loadElem("#settingsLineHeight");
        lineHeightSlider.addEventListener("input", async () => {
            await reader.store.updateSetting("lineSpacing", lineHeightSlider.value);
            reader.util.loadElem("#lineHeightNum").innerText = Number(lineHeightSlider.value).toFixed(2);
            refreshReader();
        });

        const textColorInput = reader.util.loadElem("#settingsTextColor");
        textColorInput.addEventListener("input", async () => {
            const normalized = this.resolveAccessibleColorPair(
                textColorInput.value,
                backgroundColorInput.value,
                themePalette.readerText
            );
            textColorInput.value = normalized;
            await reader.store.updateSetting("textColor", normalized);
            refreshReader();
        });

        const backgroundColorInput = reader.util.loadElem("#settingsBackgroundColor");
        backgroundColorInput.addEventListener("input", async () => {
            const normalizedBackground = this.normalizeHexColor(backgroundColorInput.value, themePalette.readerBackground);
            const normalizedText = this.resolveAccessibleColorPair(
                textColorInput.value,
                normalizedBackground,
                themePalette.readerText
            );
            backgroundColorInput.value = normalizedBackground;
            textColorInput.value = normalizedText;
            await reader.store.updateSetting("backgroundColor", normalizedBackground);
            await reader.store.updateSetting("textColor", normalizedText);
            refreshReader();
        });

        const interfaceColorInput = reader.util.loadElem("#settingsInterfaceColor");
        interfaceColorInput.addEventListener("input", async () => {
            const normalized = this.resolveAccessibleColorPair(
                interfaceColorInput.value,
                mainMenuBackgroundColorInput.value,
                "#1877f2",
                3
            );
            interfaceColorInput.value = normalized;
            await reader.store.updateSetting("interfaceColor", normalized);
            await this.applyInterfaceColorFromSettings();
        });

        const interfaceBackgroundColorInput = reader.util.loadElem("#settingsInterfaceBackgroundColor");
        interfaceBackgroundColorInput.addEventListener("input", async () => {
            const normalizedBackground = this.normalizeHexColor(interfaceBackgroundColorInput.value, themePalette.interfaceBackground);
            const normalizedText = this.resolveAccessibleColorPair(
                interfaceTextColorInput.value,
                normalizedBackground,
                themePalette.interfaceText
            );
            interfaceBackgroundColorInput.value = normalizedBackground;
            interfaceTextColorInput.value = normalizedText;
            await reader.store.updateSetting(
                "interfaceBackgroundColor",
                normalizedBackground
            );
            await reader.store.updateSetting("interfaceTextColor", normalizedText);
            await this.applyInterfaceColorFromSettings();
        });

        const interfaceTextColorInput = reader.util.loadElem("#settingsInterfaceTextColor");
        interfaceTextColorInput.addEventListener("input", async () => {
            const normalizedText = this.resolveAccessibleColorPair(
                interfaceTextColorInput.value,
                interfaceBackgroundColorInput.value,
                themePalette.interfaceText
            );
            interfaceTextColorInput.value = normalizedText;
            await reader.store.updateSetting(
                "interfaceTextColor",
                normalizedText
            );
            await this.applyInterfaceColorFromSettings();
        });

        const mainMenuBackgroundColorInput = reader.util.loadElem("#settingsMainMenuBackgroundColor");
        mainMenuBackgroundColorInput.addEventListener("input", async () => {
            const normalizedBackground = this.normalizeHexColor(mainMenuBackgroundColorInput.value, themePalette.mainMenuBackground);
            const normalizedText = this.resolveAccessibleColorPair(
                mainMenuTextColorInput.value,
                normalizedBackground,
                themePalette.mainMenuText
            );
            const normalizedInterfaceColor = this.resolveAccessibleColorPair(
                interfaceColorInput.value,
                normalizedBackground,
                "#1877f2",
                3
            );
            mainMenuBackgroundColorInput.value = normalizedBackground;
            mainMenuTextColorInput.value = normalizedText;
            interfaceColorInput.value = normalizedInterfaceColor;
            await reader.store.updateSetting(
                "mainMenuBackgroundColor",
                normalizedBackground
            );
            await reader.store.updateSetting("mainMenuTextColor", normalizedText);
            await reader.store.updateSetting("interfaceColor", normalizedInterfaceColor);
            await this.applyInterfaceColorFromSettings();
        });

        const mainMenuTextColorInput = reader.util.loadElem("#settingsMainMenuTextColor");
        mainMenuTextColorInput.addEventListener("input", async () => {
            const normalizedText = this.resolveAccessibleColorPair(
                mainMenuTextColorInput.value,
                mainMenuBackgroundColorInput.value,
                themePalette.mainMenuText
            );
            mainMenuTextColorInput.value = normalizedText;
            await reader.store.updateSetting(
                "mainMenuTextColor",
                normalizedText
            );
            await this.applyInterfaceColorFromSettings();
        });

		const setThemeMode = async theme => {
			const nextThemePalette = this.getThemePalette(theme);
			await reader.store.updateSetting("themeMode", nextThemePalette.themeMode);
			await reader.store.updateSetting("theme", nextThemePalette.theme);
			await reader.store.updateSetting("textColor", nextThemePalette.readerText);
			await reader.store.updateSetting("backgroundColor", nextThemePalette.readerBackground);
			await reader.store.updateSetting("interfaceBackgroundColor", nextThemePalette.interfaceBackground);
			await reader.store.updateSetting("interfaceTextColor", nextThemePalette.interfaceText);
			await reader.store.updateSetting("mainMenuBackgroundColor", nextThemePalette.mainMenuBackground);
			await reader.store.updateSetting("mainMenuTextColor", nextThemePalette.mainMenuText);
			const lightBtn = reader.util.loadElem("#settingsThemeModeLight");
			const darkBtn = reader.util.loadElem("#settingsThemeModeDark");
			const sepiaBtn = reader.util.loadElem("#settingsThemeModeSepia");
			const auroraBtn = reader.util.loadElem("#settingsThemeModeAurora");
			lightBtn.classList.toggle("active", nextThemePalette.theme === "light");
			darkBtn.classList.toggle("active", nextThemePalette.theme === "dark");
			sepiaBtn.classList.toggle("active", nextThemePalette.theme === "sepia");
			auroraBtn.classList.toggle("active", nextThemePalette.theme === "aurora");
			backgroundColorInput.value = nextThemePalette.readerBackground;
			textColorInput.value = nextThemePalette.readerText;
			interfaceBackgroundColorInput.value = nextThemePalette.interfaceBackground;
			interfaceTextColorInput.value = nextThemePalette.interfaceText;
			mainMenuBackgroundColorInput.value = nextThemePalette.mainMenuBackground;
			mainMenuTextColorInput.value = nextThemePalette.mainMenuText;
			this.loadTheme(nextThemePalette.theme);
			await this.applyInterfaceColorFromSettings();
			refreshReader();
		};

        reader.util.loadElem("#settingsThemeModeLight").addEventListener("click", async () => {
            await setThemeMode("light");
        });
        reader.util.loadElem("#settingsThemeModeDark").addEventListener("click", async () => {
            await setThemeMode("dark");
        });
        reader.util.loadElem("#settingsThemeModeSepia").addEventListener("click", async () => {
            await setThemeMode("sepia");
        });
        reader.util.loadElem("#settingsThemeModeAurora").addEventListener("click", async () => {
            await setThemeMode("aurora");
        });

        const pageViewSelect = reader.util.loadElem("#settingsPageView");
        pageViewSelect.addEventListener("change", async () => {
            await reader.store.updateSetting("pageViewMode", pageViewSelect.value);
            refreshReader();
        });

        const readerMarginSlider = reader.util.loadElem("#settingsReaderMargin");
        readerMarginSlider.addEventListener("input", async () => {
            await reader.store.updateSetting("readerMargin", readerMarginSlider.value);
            reader.util.loadElem("#readerMarginNum").innerText = `${readerMarginSlider.value}px`;
            refreshReader();
        });

        const maxWidthSlider = reader.util.loadElem("#settingsMaxWidth");
        maxWidthSlider.addEventListener("input", async () => {
            await reader.store.updateSetting("maxWidth", maxWidthSlider.value);
            reader.util.loadElem("#maxWidthNum").innerText = `${maxWidthSlider.value}px`;
            refreshReader();
        });

		const readerSearchFontFamilySelect = reader.util.loadElem("#settingsReaderSearchFontFamily");
		readerSearchFontFamilySelect?.addEventListener("change", async () => {
			await reader.store.updateSetting("readerSearchFontFamily", readerSearchFontFamilySelect.value);
			refreshReader();
		});

		const readerSearchFontSizeSlider = reader.util.loadElem("#settingsReaderSearchFontSize");
		readerSearchFontSizeSlider?.addEventListener("input", async () => {
			await reader.store.updateSetting("readerSearchFontSize", readerSearchFontSizeSlider.value);
			reader.util.loadElem("#readerSearchFontSizeNum").innerText = `${readerSearchFontSizeSlider.value}pt`;
			refreshReader();
		});

		const readerSearchBackgroundColorInput = reader.util.loadElem("#settingsReaderSearchBackgroundColor");
		const readerSearchTextColorInput = reader.util.loadElem("#settingsReaderSearchTextColor");
		readerSearchBackgroundColorInput?.addEventListener("input", async () => {
			const normalizedBackground = this.normalizeHexColor(readerSearchBackgroundColorInput.value, "#adff2f");
			const normalizedText = this.resolveAccessibleColorPair(
				readerSearchTextColorInput.value,
				normalizedBackground,
				"#ffffff",
				2.5
			);
			readerSearchBackgroundColorInput.value = normalizedBackground;
			readerSearchTextColorInput.value = normalizedText;
			await reader.store.updateSetting("readerSearchBackgroundColor", normalizedBackground);
			await reader.store.updateSetting("readerSearchTextColor", normalizedText);
			refreshReader();
		});

		readerSearchTextColorInput?.addEventListener("input", async () => {
			const normalizedText = this.resolveAccessibleColorPair(
				readerSearchTextColorInput.value,
				readerSearchBackgroundColorInput.value,
				"#ffffff",
				2.5
			);
			readerSearchTextColorInput.value = normalizedText;
			await reader.store.updateSetting("readerSearchTextColor", normalizedText);
			refreshReader();
		});

		const readerSearchWindowWidthSlider = reader.util.loadElem("#settingsReaderSearchWindowWidth");
		readerSearchWindowWidthSlider?.addEventListener("input", async () => {
			await reader.store.updateSetting("readerSearchWindowWidth", readerSearchWindowWidthSlider.value);
			reader.util.loadElem("#readerSearchWindowWidthNum").innerText = `${readerSearchWindowWidthSlider.value}px`;
			refreshReader();
		});

		const readerSearchWindowHeightSlider = reader.util.loadElem("#settingsReaderSearchWindowHeight");
		readerSearchWindowHeightSlider?.addEventListener("input", async () => {
			await reader.store.updateSetting("readerSearchWindowHeight", readerSearchWindowHeightSlider.value);
			reader.util.loadElem("#readerSearchWindowHeightNum").innerText = `${readerSearchWindowHeightSlider.value}px`;
			refreshReader();
		});

        const navArrowsBtn = reader.util.loadElem("#settingsNavArrows");
        navArrowsBtn.addEventListener("click", async () => {
            showNavArrows = !showNavArrows;
            navArrowsBtn.classList.toggle("active", showNavArrows);
            await reader.store.updateSetting("showNavArrows", showNavArrows);
            refreshReader();
        });

        const tapNavBtn = reader.util.loadElem("#settingsTapNav");
        tapNavBtn.addEventListener("click", async () => {
            tapToNavigate = !tapToNavigate;
            tapNavBtn.classList.toggle("active", tapToNavigate);
            await reader.store.updateSetting("tapToNavigate", tapToNavigate);
            refreshReader();
        });

        const merriamWebsterApiKeyInput = reader.util.loadElem("#settingsMerriamWebsterApiKey");
        merriamWebsterApiKeyInput?.addEventListener("change", async () => {
            merriamWebsterApiKey = String(merriamWebsterApiKeyInput.value || "").trim();
            await reader.store.updateSetting("merriamWebsterApiKey", merriamWebsterApiKey);
        });
    }
    async createTranslations() {
        this.currentView = "translations";
        this.resetContainer();
        reader.util.setTitle("Traduções - Leitor de epub Coentro");

        const container = reader.util.loadElem(".container");
        container.innerHTML = `
			<div class="translationJobsPanel">
				<div class="translationJobsTopRow">
					<div class="settingsSectionTitle">Traduções</div>
					<div id="translationLiveOverview" class="is-idle">
						<div id="translationLiveOverviewContext">Status geral das traduções</div>
						<div class="translationLiveOverviewMeta">
							<div id="translationLiveOverviewLabel">Sem traduções em andamento</div>
							<div id="translationLiveOverviewStats">0% • 0/0 capítulos</div>
						</div>
						<div id="translationLiveOverviewBar">
							<div id="translationLiveOverviewFill"></div>
							<div id="translationLiveOverviewEta" hidden>ETA --</div>
						</div>
					</div>
				</div>
				<div class="translationJobHeaderViewport">
					<div class="translationJobHeader">
						<div>Capa</div>
						<div>Título</div>
						<div>Autor</div>
						<div>Línguas</div>
						<div>Início</div>
						<div>Fim</div>
						<div>Escopo</div>
					</div>
				</div>
				<div id="translationJobList" class="translationJobList"></div>
			</div>
			<button id="translationReloadButton" class="translationReloadButton" type="button" title="Recarregar traduções" aria-label="Recarregar traduções">↻</button>
		`;

        const loadSnapshot = async () => {
            try {
                const runtimeSnapshot = await new Promise(resolve => {
                    if (!chrome?.runtime?.sendMessage) {
                        resolve(null);
                        return;
                    }
                    chrome.runtime.sendMessage({ action: "translationQueueSnapshot" }, response => {
                        if (chrome.runtime.lastError || !response?.success) {
                            resolve(null);
                            return;
                        }
                        resolve({
                            jobs: response.jobs || {},
                            queue: response.queue || []
                        });
                    });
                });
                if (runtimeSnapshot) {
                    return runtimeSnapshot;
                }
            } catch (_error) {
            }
            return {
                jobs: (await reader.store.get("translationJobsV1")) || {},
                queue: (await reader.store.get("translationQueueV1")) || []
            };
        };

        const formatDate = value => {
            if (!value) {
                return "—";
            }
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return "—";
            }
            return date.toLocaleString("pt-BR");
        };

        const escapeHtml = value => String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

        const getJobState = (item, queueSet) => {
            const totalChapters = Math.max(1, Number(item?.totalChapters) || 1);
            const skipped = Math.max(0, Math.min(totalChapters, Number(item?.skippedChapters ?? item?.startChapter) || 0));
            const scopeTotal = Math.max(0, totalChapters - skipped);
            const translatedInScope = Math.max(0, Math.min(scopeTotal, Number(item?.translatedChapters) || 0));
            const rawStatus = String(item?.status || "pending");
            const scheduledAt = Number(item?.scheduledAt) || 0;
            const isScheduled = scheduledAt > Date.now();
            const itemId = String(item?.id || "").trim();
            const status = rawStatus === "pending" && queueSet.has(itemId) && !isScheduled
                ? "running"
                : (isScheduled ? "scheduled" : rawStatus);
            const progress = Math.max(0, Math.min(100, Number(item?.progress) || 0));
            const remaining = Math.max(0, scopeTotal - translatedInScope);
            const hasError = String(item?.error || "").trim().length > 0 || String(item?.errorCode || "").trim().length > 0;
            return {
                status,
                totalChapters,
                skipped,
                scopeTotal,
                translatedInScope,
                translatedCount: skipped + translatedInScope,
                progress,
                remaining,
                hasError,
                scheduledAt
            };
        };

        const buildScopeBarHtml = (totalChapters, skipped, translatedCount) => {
            if (!totalChapters) {
                return "";
            }
            const safeSkipped = Math.max(0, Math.min(totalChapters, skipped));
            const safeTranslated = Math.max(0, Math.min(totalChapters - safeSkipped, translatedCount));
            const remaining = Math.max(0, totalChapters - safeSkipped - safeTranslated);
            const segments = [
                { type: "skipped", count: safeSkipped },
                { type: "translated", count: safeTranslated },
                { type: "toTranslate", count: remaining }
            ].filter(segment => segment.count > 0);
            return segments.map(segment => {
                const widthPct = Math.max(0, Math.min(100, (segment.count / totalChapters) * 100));
                return `<div class="translationScopeSegment translationScope-${segment.type}" style="width:${widthPct}%;"></div>`;
            }).join("");
        };

        const updateOverview = items => {
            const liveOverview = reader.util.loadElem("#translationLiveOverview");
            const liveOverviewContext = reader.util.loadElem("#translationLiveOverviewContext");
            const liveOverviewLabel = reader.util.loadElem("#translationLiveOverviewLabel");
            const liveOverviewStats = reader.util.loadElem("#translationLiveOverviewStats");
            const liveOverviewFill = reader.util.loadElem("#translationLiveOverviewFill");
            const liveOverviewEta = reader.util.loadElem("#translationLiveOverviewEta");
            if (!liveOverview || !liveOverviewContext || !liveOverviewLabel || !liveOverviewStats || !liveOverviewFill || !liveOverviewEta) {
                return;
            }

            const totals = {
                scope: 0,
                done: 0,
                running: 0,
                queued: 0,
                paused: 0,
                error: 0
            };
            let currentRunning = null;

            items.forEach(item => {
                const state = item.__state;
                totals.scope += state.scopeTotal;
                totals.done += state.translatedInScope;
                if (state.status === "running") {
                    totals.running += 1;
                    if (!currentRunning) {
                        currentRunning = item;
                    }
                } else if (state.status === "pending" || state.status === "scheduled") {
                    totals.queued += 1;
                } else if (state.status === "paused") {
                    totals.paused += 1;
                } else if (state.status === "error") {
                    totals.error += 1;
                }
            });

            const percent = totals.scope > 0 ? Math.round((totals.done / totals.scope) * 100) : 0;
            liveOverviewFill.style.width = `${percent}%`;
            liveOverview.classList.remove("is-running", "is-paused", "is-error", "is-complete", "is-idle");

            if (currentRunning) {
                liveOverview.classList.add("is-running");
                liveOverviewContext.innerText = `Traduzindo ${currentRunning.title || "livro sem título"}`;
                liveOverviewLabel.innerText = `Capítulo ${Math.max(1, Number(currentRunning.currentChapter) || 1)} em andamento`;
                liveOverviewEta.hidden = true;
            } else if (totals.error > 0) {
                liveOverview.classList.add("is-error");
                liveOverviewContext.innerText = "Há tarefas com erro";
                liveOverviewLabel.innerText = "Revise ou retome as traduções com falha";
                liveOverviewEta.hidden = true;
            } else if (totals.paused > 0) {
                liveOverview.classList.add("is-paused");
                liveOverviewContext.innerText = "Traduções pausadas";
                liveOverviewLabel.innerText = "Há tarefas interrompidas aguardando retomada";
                liveOverviewEta.hidden = true;
            } else if (totals.scope > 0 && totals.done >= totals.scope) {
                liveOverview.classList.add("is-complete");
                liveOverviewContext.innerText = "Fila concluída";
                liveOverviewLabel.innerText = "Todas as traduções visíveis foram concluídas";
                liveOverviewEta.hidden = true;
            } else {
                liveOverview.classList.add("is-idle");
                liveOverviewContext.innerText = "Status geral das traduções";
                liveOverviewLabel.innerText = "Sem traduções em andamento";
                liveOverviewEta.hidden = true;
            }

            liveOverviewStats.innerText = `${percent}% • ${totals.done}/${totals.scope} capítulos • ${totals.running} ativas • ${totals.queued} na fila`;
        };

        const sendTranslationControl = async (action, jobId) => {
            if (!chrome?.runtime?.sendMessage) {
                return false;
            }
            return await new Promise(resolve => {
                chrome.runtime.sendMessage({ action, jobId }, response => {
                    resolve(Boolean(response?.success));
                });
            });
        };

        const renderList = async () => {
            const listElem = reader.util.loadElem("#translationJobList");
            const headerElem = reader.util.loadElem(".translationJobHeader");
            if (!listElem || this.currentView !== "translations") {
                return;
            }

            const prevScrollTop = Number(listElem.scrollTop) || 0;
            const prevScrollLeft = Number(listElem.scrollLeft) || 0;
            const snapshot = await loadSnapshot();
            const jobs = Object.values(snapshot?.jobs || {}).filter(Boolean);
            const queueSet = new Set(Array.isArray(snapshot?.queue) ? snapshot.queue : []);
            const preferredTarget = reader.util.normalizeLanguageCode((await reader.store.loadSetting("preferredLanguage")) || "pt");
            const byBook = new Map();

            jobs.forEach(item => {
                if (!item?.title) {
                    return;
                }
                const targetLanguage = reader.util.normalizeLanguageCode(item.targetLanguage || "");
                if (preferredTarget && targetLanguage && targetLanguage !== preferredTarget) {
                    return;
                }
                const state = getJobState(item, queueSet);
                const key = String(item.bookStorageKey || `${item.title}::${item.author || ""}`).trim().toLowerCase();
                const previous = byBook.get(key);
                const score = (
                    (state.status === "running" ? 500 : 0) +
                    (state.status === "error" ? 400 : 0) +
                    (state.status === "paused" ? 300 : 0) +
                    (state.status === "pending" || state.status === "scheduled" ? 200 : 0) +
                    (state.remaining > 0 ? 100 : 0) +
                    state.progress
                );
                if (!previous || score > previous.__score || (score === previous.__score && (Number(item.updatedAt) || 0) > (Number(previous.updatedAt) || 0))) {
                    byBook.set(key, {
                        ...item,
                        __state: state,
                        __score: score
                    });
                }
            });

            const items = [...byBook.values()].sort((a, b) => {
                const aTime = Number(a.startedAt) || Number(a.queuedAt) || Number(a.updatedAt) || 0;
                const bTime = Number(b.startedAt) || Number(b.queuedAt) || Number(b.updatedAt) || 0;
                if (bTime !== aTime) {
                    return bTime - aTime;
                }
                return String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");
            });

            const statusLabels = {
                pending: "Pendente",
                scheduled: "Agendado",
                running: "Traduzindo",
                paused: "Pausado",
                completed: "Concluído",
                error: "Erro"
            };

            listElem.innerHTML = items.length ? items.map(item => {
                const state = item.__state;
                const languagePair = `${reader.util.getLanguageLabel(reader.util.normalizeLanguageCode(item.sourceLanguage || "") || "unknown")} → ${reader.util.getLanguageLabel(reader.util.normalizeLanguageCode(item.targetLanguage || "") || "unknown")}`;
                const scopeBarHtml = buildScopeBarHtml(state.totalChapters, state.skipped, state.translatedInScope);
                const statusText = state.status === "scheduled"
                    ? `${statusLabels[state.status]} (${Math.max(1, Math.ceil((state.scheduledAt - Date.now()) / 1000))}s)`
                    : (statusLabels[state.status] || "Pendente");
                const canPause = state.status === "running" || state.status === "pending" || state.status === "scheduled";
                const canResume = state.status === "paused" || state.status === "error" || (state.status === "completed" && state.remaining > 0) || (state.remaining > 0 && !canPause);
                const actionHtml = canPause
                    ? `<button class="translationJobActionBtn" type="button" data-job-id="${escapeHtml(item.id)}" data-action="pause" title="Interromper tradução">⏸</button>`
                    : (canResume
                        ? `<button class="translationJobActionBtn is-play" type="button" data-job-id="${escapeHtml(item.id)}" data-action="resume" title="Retomar / recuperar">▶</button>`
                        : `<button class="translationJobActionBtn is-disabled" type="button" disabled title="Sem ação disponível">—</button>`);
                const deleteHtml = `<button class="translationJobActionBtn is-delete" type="button" data-job-id="${escapeHtml(item.id)}" data-action="delete" title="Excluir / abortar tarefa">✕</button>`;
                const errorHtml = state.hasError
                    ? `<div class="translationJobErrorAlert" role="alert"><div class="translationJobErrorTitle">${escapeHtml(String(item.errorCode || "TRN-ERR"))}</div><div class="translationJobErrorSummary">${escapeHtml(String(item.errorSummary || item.error || "Falha de tradução"))}</div></div>`
                    : "";
                return `
					<div class="translationJobRow" data-status="${escapeHtml(state.status)}">
						<div class="translationJobCover">
							${item.cover ? `<img src="${escapeHtml(item.cover)}" draggable="false">` : ""}
							<div class="translationJobCoverActions">${actionHtml}${deleteHtml}</div>
						</div>
						<div class="translationJobTitle">${escapeHtml(item.title)}</div>
						<div class="translationJobAuthor">${escapeHtml(item.author || "—")}</div>
						<div class="translationJobLanguages">${escapeHtml(languagePair)}</div>
						<div class="translationJobStart">${escapeHtml(formatDate(item.startedAt || item.createdAt || item.queuedAt))}</div>
						<div class="translationJobEnd">${escapeHtml(formatDate(item.finishedAt || item.updatedAt))}</div>
						<div class="translationJobScope">
							<div class="translationScopeStatusLine">${escapeHtml(statusText)}</div>
							<div class="translationScopeProgressLine">${state.progress}%</div>
							<div class="translationScopeBar">${scopeBarHtml}</div>
							<div class="translationScopeLegend">${state.translatedCount}/${state.totalChapters} traduzidos • ${state.skipped}/${state.totalChapters} lidos • ${state.remaining} para traduzir</div>
							${errorHtml}
						</div>
					</div>
				`;
            }).join("") : `<div class="translationJobEmpty">Nenhuma ação de tradução registrada ainda.</div>`;

            listElem.scrollTop = Math.max(0, prevScrollTop);
            listElem.scrollLeft = Math.max(0, prevScrollLeft);
            if (headerElem) {
                headerElem.style.transform = `translateX(${-Math.max(0, Number(listElem.scrollLeft) || 0)}px)`;
            }
            updateOverview(items);
        };

        if (this.translationJobListScrollHandler) {
            const previousListScroller = reader.util.loadElem("#translationJobList");
            previousListScroller?.removeEventListener("scroll", this.translationJobListScrollHandler);
        }
        this.translationJobListScrollHandler = event => {
            const headerElem = reader.util.loadElem(".translationJobHeader");
            const listElem = event?.currentTarget;
            if (!headerElem || !listElem) {
                return;
            }
            headerElem.style.transform = `translateX(${-Math.max(0, Number(listElem.scrollLeft) || 0)}px)`;
        };
        reader.util.loadElem("#translationJobList")?.addEventListener("scroll", this.translationJobListScrollHandler, { passive: true });

        if (this.translationJobActionHandler) {
            container.removeEventListener("click", this.translationJobActionHandler);
        }
        this.translationJobActionHandler = async event => {
            const actionBtn = event.target?.closest?.(".translationJobActionBtn[data-action]");
            if (!actionBtn || this.currentView !== "translations") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const jobId = String(actionBtn.getAttribute("data-job-id") || "").trim();
            const buttonAction = String(actionBtn.getAttribute("data-action") || "").trim();
            if (!jobId || !buttonAction) {
                return;
            }
            actionBtn.disabled = true;
            const runtimeAction = buttonAction === "pause"
                ? "translationQueuePause"
                : (buttonAction === "resume" ? "translationQueueResume" : "translationQueueDelete");
            await sendTranslationControl(runtimeAction, jobId);
            await renderList();
        };
        container.addEventListener("click", this.translationJobActionHandler);

        reader.util.loadElem("#translationReloadButton")?.addEventListener("click", async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await renderList();
            } finally {
                window.setTimeout(() => {
                    button.disabled = false;
                }, 250);
            }
        });

        await renderList();
        this.translationJobsRefreshTimer = window.setInterval(() => {
            void renderList();
        }, 1000);
    }

    async createDailyTrackers() {
        this.currentView = "trackers";
        this.resetContainer();
        reader.util.setTitle("Gráficos Diários - Leitor de epub Coentro");

        const container = reader.util.loadElem(".container");
        container.innerHTML = `
			<div class="readingControlsHolder">
				<div class="readingStatsHeader">
					<div class="settingsSectionTitle">Gráficos Diários</div>
				</div>
				<div class="libraryControlsSection">
					<div class="dropdown" id="exportDropdown">
						<button id="exportButton">Exportar</button>
						<div class="dropdownMenu" id="exportMenu">
							<button data-export="csv">Exportar CSV</button>
							<button data-export="png">Exportar PNG</button>
							<button data-export="pdf">Exportar PDF</button>
						</div>
					</div>
					<div class="dropdown" id="importDropdown">
						<button id="importButton">Importar</button>
						<div class="dropdownMenu" id="importMenu">
							<button data-import="override">CSV: substituir datas do arquivo</button>
							<button data-import="sum">CSV: somar nas datas</button>
							<button data-import="fill">CSV: preencher datas faltantes</button>
						</div>
					</div>
				</div>
			</div>
			<div id="readingStatsExport">
				<div class="bookCompletionMeters" id="bookCompletionMeters">
					<div class="readingSubTitle">Leitura terminada</div>
					<div class="completionMeterCard" data-range="30">
						<div class="completionMeterHead">
							<img src="assets/30-days.png" alt="?ltimos 30 dias">
							<span class="completionMeterTitle">30 dias</span>
						</div>
						<div class="completionMeterValue" id="completion30Value">0</div>
						<div class="completionMeterTrack"><div class="completionMeterFill" id="completion30Fill"></div></div>
					</div>
					<div class="completionMeterCard" data-range="365">
						<div class="completionMeterHead">
							<img src="assets/365.png" alt="?ltimos 365 dias">
							<span class="completionMeterTitle">365 dias</span>
						</div>
						<div class="completionMeterValue" id="completion365Value">0</div>
						<div class="completionMeterTrack"><div class="completionMeterFill" id="completion365Fill"></div></div>
					</div>
					<div class="completionMeterCard" data-range="lifetime">
						<div class="completionMeterHead">
							<img src="assets/lifetime.png" alt="Lifetime">
							<span class="completionMeterTitle">Lifetime</span>
						</div>
						<div class="completionMeterValue" id="completionLifetimeValue">0</div>
						<div class="completionMeterTrack"><div class="completionMeterFill" id="completionLifetimeFill"></div></div>
					</div>
				</div>
				<div class="readingStats">
					<div>
						<div class="readingSubTitle">Calend?rio de leitura</div>
						<div id="readingCalendarTitle"></div>
						<div class="readingCalendarGrid" id="readingCalendarGrid"></div>
					</div>
					<div>
						<div class="readingSubTitle">Palavras lidas (7 dias)</div>
						<div class="readingWordsList" id="readingWordsList"></div>
					</div>
					<div class="readingStreak">
						<div class="readingSubTitle">Streak (?ltimos 30 dias)</div>
						<svg id="readingStreakChart" viewBox="0 0 600 140" preserveAspectRatio="none"></svg>
						<div class="dayPeriodGraphic" id="dayPeriodGraphic"></div>
					</div>
				</div>
				<div class="heatmapContainer">
					<div class="readingSubTitle">Heatmap anual de leitura</div>
					<div class="heatmapWrapper">
						<div class="heatmapMonths" id="heatmapMonths"></div>
						<div class="heatmapGrid" id="heatmapGrid"></div>
						<div class="heatmapLegend">
							<span class="heatmapLegendLabel">Menos</span>
							<div class="heatmapLegendColors">
								<div class="heatmapLegendCell" data-level="0"></div>
								<div class="heatmapLegendCell" data-level="1"></div>
								<div class="heatmapLegendCell" data-level="2"></div>
								<div class="heatmapLegendCell" data-level="3"></div>
								<div class="heatmapLegendCell" data-level="4"></div>
							</div>
							<span class="heatmapLegendLabel">Mais</span>
						</div>
					</div>
				</div>
			</div>
		`;

        const calendarSectionTitle = container.querySelector(".readingStats > div:nth-child(1) .readingSubTitle");
        if (calendarSectionTitle) {
            calendarSectionTitle.innerText = "Calend?rio de leitura";
        }

        const exportDropdown = reader.util.loadElem("#exportDropdown");
        const exportMenu = reader.util.loadElem("#exportMenu");
        this.setupExportDropdown(exportDropdown);

        const importDropdown = reader.util.loadElem("#importDropdown");
        const importMenu = reader.util.loadElem("#importMenu");
        this.setupExportDropdown(importDropdown);

        exportMenu.addEventListener("click", async event => {
            if (event.target.tagName !== "BUTTON") {
                return;
            }
            const type = event.target.dataset.export;
            exportDropdown.classList.remove("open");
            if (type === "csv") {
                await this.exportReadingStatsCsv();
            }
            if (type === "png") {
                await this.exportStatsPng();
            }
            if (type === "pdf") {
                await this.exportStatsPdf();
            }
        });

        const csvInput = reader.util.loadElem("#csvInput");
        importMenu.addEventListener("click", event => {
            if (event.target.tagName !== "BUTTON") {
                return;
            }
            const mode = event.target.dataset.import || "override";
            importDropdown.classList.remove("open");
            csvInput.setAttribute("data-import-mode", mode);
            csvInput.click();
        });
        csvInput.addEventListener("change", async () => {
            const mode = csvInput.getAttribute("data-import-mode") || "override";
            await this.importReadingStatsCsv(csvInput, mode);
            csvInput.value = "";
        });

        await this.renderReadingStats();
    }

    async exportReadingStatsCsv() {
        const stats = await reader.store.getReadingStats();
        const days = stats.days || {};
        const words = stats.words || {};
        const dayParts = stats.dayParts || {};

        const keys = new Set([
            ...Object.keys(days),
            ...Object.keys(words),
            ...Object.keys(dayParts)
        ]);

        const sortedKeys = [...keys].sort((a, b) => {
            const [ay, am, ad] = a.split("-").map(Number);
            const [by, bm, bd] = b.split("-").map(Number);
            return new Date(ay, am - 1, ad) - new Date(by, bm - 1, bd);
        });

        const headers = [
            "date",
            "seconds_read",
            "words_read",
            "morning_seconds",
            "afternoon_seconds",
            "night_seconds",
            "goal"
        ];

        const rows = sortedKeys.map(key => {
            const parts = dayParts[key] || {};
            return [
                key,
                days[key] || 0,
                words[key] || 0,
                parts.morning || 0,
                parts.afternoon || 0,
                parts.night || 0,
                stats.goal || 300
            ];
        });

        const csv = this.buildCsv(headers, rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        this.downloadBlob(blob, `daily-trackers-${this.getDateStamp()}.csv`);
    }

    async importReadingStatsCsv(input, mode = "override") {
        const file = input.files && input.files[0];
        if (!file) {
            return;
        }

        const text = await file.text();
        const fileHash = this.hashText(text);
        const importHistory = (await reader.store.get("readingStatsImports")) || [];
        const previousImport = importHistory.find(entry => entry && entry.hash === fileHash);
        if (previousImport) {
            const importedAt = previousImport.importedAt ? new Date(previousImport.importedAt) : null;
            const importedAtLabel = importedAt ? importedAt.toLocaleString("pt-BR") : null;

            this.createInfoBox(`
				<div class="infoBoxItem">
					<span class="infoBoxItemTitle">ImportaÃƒÂ§ÃƒÂ£o ignorada</span>
					<span>Este arquivo jÃƒÂ¡ foi importado${importedAtLabel ? ` em ${importedAtLabel}` : ""}.</span>
				</div>
			`, "Daily Trackers");
            return;
        }
        const rows = this.parseCsv(text);
        if (!rows.length) {
            return;
        }

        const headers = rows.shift().map(header => header.replace(/^\uFEFF/, "").trim().toLowerCase());
        const headerIndex = name => headers.indexOf(name);
        const dateIndex = headerIndex("date") >= 0 ? headerIndex("date") : headerIndex("data");
        const secondsIndex = headerIndex("seconds_read");
        const minutesIndex = headerIndex("minutes_read");
        const wordsIndex = headerIndex("words_read");
        const morningIndex = headerIndex("morning_seconds");
        const afternoonIndex = headerIndex("afternoon_seconds");
        const nightIndex = headerIndex("night_seconds");
        const goalIndex = headerIndex("goal");

        const stats = await reader.store.getReadingStats();
        const nextStats = {
            days: { ...(stats.days || {}) },
            words: { ...(stats.words || {}) },
            dayParts: { ...(stats.dayParts || {}) },
            goal: stats.goal || 300
        };

        let imported = 0;
        let skipped = 0;
        let skippedExisting = 0;
        let goalValue = nextStats.goal;

        const importTotals = {};

        for (const row of rows) {
            const dateValue = dateIndex >= 0 ? row[dateIndex] : "";
            const key = this.parseDateToKey(dateValue);
            if (!key) {
                skipped += 1;
                continue;
            }

            const secondsValue = secondsIndex >= 0 ? Number(row[secondsIndex]) : NaN;
            const minutesValue = minutesIndex >= 0 ? Number(row[minutesIndex]) : NaN;
            const seconds = Number.isFinite(secondsValue)
                ? secondsValue
                : (Number.isFinite(minutesValue) ? minutesValue * 60 : 0);

            const words = wordsIndex >= 0 ? Number(row[wordsIndex]) : 0;
            const morning = morningIndex >= 0 ? Number(row[morningIndex]) : 0;
            const afternoon = afternoonIndex >= 0 ? Number(row[afternoonIndex]) : 0;
            const night = nightIndex >= 0 ? Number(row[nightIndex]) : 0;

            const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
            const safeWords = Math.max(0, Number.isFinite(words) ? words : 0);
            const safeMorning = Math.max(0, Number.isFinite(morning) ? morning : 0);
            const safeAfternoon = Math.max(0, Number.isFinite(afternoon) ? afternoon : 0);
            const safeNight = Math.max(0, Number.isFinite(night) ? night : 0);

            if (goalIndex >= 0 && row[goalIndex] && Number.isFinite(Number(row[goalIndex]))) {
                goalValue = Number(row[goalIndex]);
            }

            if (!importTotals[key]) {
                importTotals[key] = { seconds: 0, words: 0, morning: 0, afternoon: 0, night: 0 };
            }

            importTotals[key].seconds += safeSeconds;
            importTotals[key].words += safeWords;
            importTotals[key].morning += safeMorning;
            importTotals[key].afternoon += safeAfternoon;
            importTotals[key].night += safeNight;
        }

        for (const [key, totals] of Object.entries(importTotals)) {
            const existingDays = nextStats.days[key] || 0;
            const existingWords = nextStats.words[key] || 0;
            const existingParts = nextStats.dayParts[key];
            const hasExisting = existingDays > 0
                || existingWords > 0
                || (existingParts && (existingParts.morning || existingParts.afternoon || existingParts.night));

            if (mode !== "override" && hasExisting) {
                skippedExisting += 1;
                continue;
            }

            if (mode === "sum") {
                nextStats.days[key] = existingDays + totals.seconds;
                nextStats.words[key] = existingWords + totals.words;
                nextStats.dayParts[key] = {
                    morning: (existingParts && existingParts.morning ? existingParts.morning : 0) + totals.morning,
                    afternoon: (existingParts && existingParts.afternoon ? existingParts.afternoon : 0) + totals.afternoon,
                    night: (existingParts && existingParts.night ? existingParts.night : 0) + totals.night
                };
            } else {
                nextStats.days[key] = totals.seconds;
                nextStats.words[key] = totals.words;
                nextStats.dayParts[key] = {
                    morning: totals.morning,
                    afternoon: totals.afternoon,
                    night: totals.night
                };
            }

            imported += 1;
        }

        if (Number.isFinite(goalValue)) {
            nextStats.goal = goalValue;
        }

        await reader.store.set("readingStats", nextStats);
        const updatedHistory = [...importHistory, {
            hash: fileHash,
            name: file.name || "",
            importedAt: Date.now()
        }];
        if (updatedHistory.length > 50) {
            updatedHistory.splice(0, updatedHistory.length - 50);
        }
        await reader.store.set("readingStatsImports", updatedHistory);
        await this.renderReadingStats();

        const modeLabel = mode === "sum"
            ? "somando datas"
            : mode === "fill"
                ? "preenchendo datas faltantes"
                : "substituindo datas";

        this.createInfoBox(`
			<div class="infoBoxItem">
				<span class="infoBoxItemTitle">ImportaÃ§Ã£o concluÃ­da</span>
				<span>${imported} datas importadas${skipped ? `, ${skipped} linhas ignoradas` : ""}${skippedExisting ? `, ${skippedExisting} datas jÃƒÂ¡ existentes` : ""} (${modeLabel}).</span>
			</div>
		`, "Daily Trackers");
    }

    getCssText() {
        const styles = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    styles.push(rule.cssText);
                }
            } catch (_error) {
                continue;
            }
        }
        return styles.join("\n");
    }

    async renderElementToPng(element, scale = 2) {
        const rect = element.getBoundingClientRect();
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);

        const html = element.outerHTML;
        const css = this.getCssText();

        const svg = `
			<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
				<foreignObject width="100%" height="100%">
					<div xmlns="http://www.w3.org/1999/xhtml" style="width: ${width}px; height: ${height}px;">
						<style>${css}</style>
						${html}
					</div>
				</foreignObject>
			</svg>
		`;

        const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);

        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = width * scale;
                canvas.height = height * scale;
                const ctx = canvas.getContext("2d");
                ctx.scale(scale, scale);
                ctx.drawImage(image, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL("image/png"));
            };
            image.onerror = error => {
                URL.revokeObjectURL(url);
                reject(error);
            };
            image.src = url;
        });
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        this.downloadDataUrl(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    downloadDataUrl(url, filename) {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    async exportStatsPng() {
        const target = reader.util.loadElem("#readingStatsExport");
        if (!target) {
            return;
        }
        const dataUrl = await this.renderElementToPng(target);
        this.downloadDataUrl(dataUrl, `daily-trackers-${this.getDateStamp()}.png`);
    }

    async exportStatsPdf() {
        const target = reader.util.loadElem("#readingStatsExport");
        if (!target) {
            return;
        }
        const dataUrl = await this.renderElementToPng(target, 2);
        const popup = window.open("");
        if (!popup) {
            this.createInfoBox(`
				<div class="infoBoxItem">
					<span class="infoBoxItemTitle">ExportaÃ§Ã£o bloqueada</span>
					<span>Permita pop-ups para salvar o PDF.</span>
				</div>
			`, "Daily Trackers");
            return;
        }

        popup.document.write(`
			<!DOCTYPE html>
			<html>
				<head>
					<title>Daily Trackers</title>
					<style>
						* { box-sizing: border-box; }
						body { margin: 0; padding: 20px; background: #fff; }
						img { width: 100%; height: auto; }
					</style>
				</head>
				<body>
					<img src="${dataUrl}">
				</body>
			</html>
		`);
        popup.document.close();
        popup.addEventListener("load", () => {
            popup.focus();
            popup.print();
        });
    }

    async renderReadingStats() {
        const stats = await reader.store.getReadingStats();
        const days = stats.days || {};
        const words = stats.words || {};
        const dayParts = stats.dayParts || {};
        await this.renderBookCompletionMeters();

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const startDow = monthStart.getDay();
        const totalDays = monthEnd.getDate();

        const calendarTitle = monthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        reader.util.loadElem("#readingCalendarTitle").innerText = calendarTitle;

        const weekdayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
        let calendarHtml = weekdayLabels.map(label => `<div class="calendarLabel">${label}</div>`).join("");

        for (let i = 0; i < startDow; i++) {
            calendarHtml += `<div class="calendarCell empty"></div>`;
        }

        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(now.getFullYear(), now.getMonth(), day);
            const key = reader.util.getDateString(date);
            const seconds = days[key] || 0;
            const minutes = Math.round(seconds / 60);
            const value = minutes ? `${minutes} min` : "&mdash;";
            calendarHtml += `
				<div class="calendarCell ${minutes ? "active" : ""}">
					<div class="calendarDay">${day}</div>
					<div class="calendarValue">${value}</div>
				</div>
			`;
        }

        reader.util.loadElem("#readingCalendarGrid").innerHTML = calendarHtml;

        this.renderDayPeriodGraphic(dayParts, days);

        const wordsList = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const key = reader.util.getDateString(date);
            const value = words[key] || 0;
            const label = date.toLocaleDateString("pt-BR", { month: "short", day: "numeric" });
            wordsList.push(`
				<div class="readingWordRow">
					<span>${label}</span>
					<span>${value.toLocaleString("pt-BR")}</span>
				</div>
			`);
        }
        reader.util.loadElem("#readingWordsList").innerHTML = wordsList.join("");

        const streakData = [];
        const daysToChart = 30;
        for (let i = daysToChart - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            streakData.push(this.getStreakForDate(date, days));
        }

        const maxStreak = Math.max(1, ...streakData);
        const width = 600;
        const height = 140;
        const padding = 20;
        const xStep = (width - padding * 2) / (streakData.length - 1);
        const yRange = height - padding * 2;

        const points = streakData.map((value, index) => {
            const x = padding + xStep * index;
            const y = height - padding - (value / maxStreak) * yRange;
            return `${x},${y}`;
        }).join(" ");

        const chart = `
			<polyline class="streakLine" points="${points}"></polyline>
			${streakData.map((value, index) => {
            const x = padding + xStep * index;
            const y = height - padding - (value / maxStreak) * yRange;
            return `<circle class="streakDot" cx="${x}" cy="${y}" r="3"></circle>`;
        }).join("")}
		`;

        reader.util.loadElem("#readingStreakChart").innerHTML = chart;

        // Animate the chart after a short delay
        setTimeout(() => {
            this.animateChart();
        }, 100);

        this.renderHeatmap(days);

        this.setupStatsAnimations();
    }

    async renderBookCompletionMeters() {
        const events = await reader.store.loadBookCompletionEvents();
        const statuses = await reader.store.loadBookStatuses();
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const cutoff30 = now - (30 * dayMs);
        const cutoff365 = now - (365 * dayMs);

        const safeEvents = Array.isArray(events)
            ? events.filter(entry => Number(entry?.completedAt) > 0)
            : [];

        const lifetimeFallback = Object.values(statuses || {}).filter(status => status === "read").length;
        const usingFallback = safeEvents.length === 0 && lifetimeFallback > 0;
        const lifetime = safeEvents.length > 0 ? safeEvents.length : lifetimeFallback;
        const in30 = usingFallback
            ? lifetimeFallback
            : safeEvents.filter(entry => Number(entry.completedAt) >= cutoff30).length;
        const in365 = usingFallback
            ? lifetimeFallback
            : safeEvents.filter(entry => Number(entry.completedAt) >= cutoff365).length;

        const lifetimeValue = reader.util.loadElem("#completionLifetimeValue");
        const days30Value = reader.util.loadElem("#completion30Value");
        const days365Value = reader.util.loadElem("#completion365Value");
        const lifetimeFill = reader.util.loadElem("#completionLifetimeFill");
        const days30Fill = reader.util.loadElem("#completion30Fill");
        const days365Fill = reader.util.loadElem("#completion365Fill");
        if (!lifetimeValue || !days30Value || !days365Value || !lifetimeFill || !days30Fill || !days365Fill) {
            return;
        }

        lifetimeValue.innerText = String(lifetime);
        days30Value.innerText = String(in30);
        days365Value.innerText = String(in365);

        const max = Math.max(1, lifetime, in365, in30);
        lifetimeFill.style.width = `${Math.round((lifetime / max) * 100)}%`;
        days365Fill.style.width = `${Math.round((in365 / max) * 100)}%`;
        days30Fill.style.width = `${Math.round((in30 / max) * 100)}%`;
    }

    renderDayPeriodGraphic(dayParts, days) {
        const now = new Date();
        const totals = { morning: 0, afternoon: 0, night: 0 };

        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const key = reader.util.getDateString(date);
            const daySeconds = (days && days[key]) ? days[key] : 0;
            const part = dayParts[key];
            if (!part && !daySeconds) {
                continue;
            }
            if (!part) {
                totals.night += daySeconds;
                continue;
            }

            const morning = part.morning || 0;
            const afternoon = part.afternoon || 0;
            const night = part.night || 0;
            const partsTotal = morning + afternoon + night;

            if (daySeconds && partsTotal > 0) {
                const scale = daySeconds / partsTotal;
                totals.morning += morning * scale;
                totals.afternoon += afternoon * scale;
                totals.night += night * scale;
            } else {
                totals.morning += morning;
                totals.afternoon += afternoon;
                totals.night += night;
            }
        }

        const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
        const max = Math.max(1, totals.morning, totals.afternoon, totals.night);

        const rows = [
            { key: "morning", label: "Manhã" },
            { key: "afternoon", label: "Tarde" },
            { key: "night", label: "Noite" }
        ];

        const html = `
			<div class="readingSubTitle">Melhor período de leitura (últimos 30 dias)</div>
			<div class="dayPeriodBars">
				${rows.map(row => {
            const value = totals[row.key];
            const percent = Math.round(value / max * 100);
            const minutes = Math.round(value / 60);
            return `
						<div class="dayPeriodRow ${row.key === best ? "best" : ""}">
							<span class="dayPeriodLabel">${row.label}</span>
							<div class="dayPeriodBar">
								<div class="dayPeriodFill" style="width: ${percent}%;"></div>
							</div>
							<span class="dayPeriodValue">${minutes} min</span>
						</div>
					`;
        }).join("")}

				
					</div>
				</div>
			</div>
		`;

        reader.util.loadElem("#dayPeriodGraphic").innerHTML = html;
    }

    animateChart() {
        const chart = reader.util.loadElem("#readingStreakChart");
        if (!chart) return;

        const line = chart.querySelector(".streakLine");
        const dots = chart.querySelectorAll(".streakDot");

        if (line && window.gsap) {
            // Animate line drawing
            window.gsap.drawPath(line, 2.5);
        }

        if (dots && dots.length > 0 && window.gsap) {
            // Animate dots with stagger and pulse
            dots.forEach((dot, index) => {
                // Initial state
                dot.style.opacity = "0";
                dot.style.transform = "scale(0)";

                // Animate in with stagger
                setTimeout(() => {
                    if (window.gsap) {
                        window.gsap.to(dot, {
                            opacity: 1,
                            scale: 1,
                            duration: 0.4,
                            ease: "back.out(1.7)"
                        });

                        // Start pulsing after appearing
                        setTimeout(() => {
                            if (window.gsap.pulse) {
                                window.gsap.pulse(dot, {
                                    scale: 1.3,
                                    duration: 1.5,
                                    repeat: -1,
                                    delay: index * 0.1
                                });
                            }
                        }, 400 + index * 50);
                    }
                }, 500 + index * 30);
            });
        }
    }

    renderHeatmap(days) {
        const now = new Date();
        const currentYear = now.getFullYear();

        // Get start of year
        const yearStart = new Date(currentYear, 0, 1);
        const yearEnd = new Date(currentYear, 11, 31);

        // Calculate all days in the year
        const allDays = [];
        const currentDate = new Date(yearStart);

        while (currentDate <= yearEnd) {
            const key = reader.util.getDateString(currentDate);
            const seconds = days[key] || 0;
            allDays.push({
                date: new Date(currentDate),
                key: key,
                seconds: seconds
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Find max value for normalization
        const maxSeconds = Math.max(...allDays.map(d => d.seconds), 1);

        // Calculate intensity level (0-4)
        const getIntensityLevel = (seconds) => {
            if (seconds === 0) return 0;
            const ratio = seconds / maxSeconds;
            if (ratio < 0.2) return 1;
            if (ratio < 0.4) return 2;
            if (ratio < 0.7) return 3;
            return 4;
        };

        // Group days by week
        const weeks = [];
        let currentWeek = [];
        let weekStartDay = yearStart.getDay(); // 0 = Sunday, 1 = Monday, etc.

        // Add empty cells for days before the first day of the year
        for (let i = 0; i < weekStartDay; i++) {
            currentWeek.push(null);
        }

        allDays.forEach(day => {
            currentWeek.push(day);
            if (currentWeek.length === 7) {
                weeks.push([...currentWeek]);
                currentWeek = [];
            }
        });

        // Add remaining days to last week
        if (currentWeek.length > 0) {
            while (currentWeek.length < 7) {
                currentWeek.push(null);
            }
            weeks.push(currentWeek);
        }

        // Generate month labels - find first day of each month
        const monthLabels = [];
        const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const monthFirstDays = {};

        // Find first occurrence of each month in weeks
        weeks.forEach((week, weekIndex) => {
            week.forEach(day => {
                if (day && day.date.getDate() === 1) {
                    const month = day.date.getMonth();
                    if (!monthFirstDays.hasOwnProperty(month)) {
                        monthFirstDays[month] = weekIndex;
                    }
                }
            });
        });

        // Build month labels array
        const sortedMonths = Object.keys(monthFirstDays).map(m => parseInt(m)).sort((a, b) => a - b);
        sortedMonths.forEach((month, index) => {
            const startWeek = monthFirstDays[month];
            const endWeek = index < sortedMonths.length - 1
                ? monthFirstDays[sortedMonths[index + 1]] - 1
                : weeks.length - 1;
            monthLabels.push({ month, startWeek, endWeek });
        });

        // Render months
        const monthsHtml = monthLabels.map(({ month, startWeek, endWeek }) => {
            const width = (endWeek - startWeek + 1) * 14; // 11px cell + 3px gap
            return `<div class="heatmapMonth" style="width: ${width}px;">${monthNames[month]}</div>`;
        }).join("");

        reader.util.loadElem("#heatmapMonths").innerHTML = monthsHtml;

        // Render weekdays
        const weekdayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
        const weekdaysHtml = weekdayLabels.map(label =>
            `<div class="heatmapWeekday">${label}</div>`
        ).join("");

        // Render weeks
        const weeksHtml = weeks.map((week, weekIndex) => {
            const weekHtml = week.map((day, dayIndex) => {
                if (!day) {
                    return `<div class="heatmapCell" data-level="0" data-week-index="${weekIndex}" data-day-index="${dayIndex}" style="--week-index: ${weekIndex}; --day-index: ${dayIndex};"></div>`;
                }

                const level = getIntensityLevel(day.seconds);
                const minutes = Math.round(day.seconds / 60);
                const dateStr = day.date.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric"
                });

                return `
					<div class="heatmapCell" data-level="${level}" data-date="${day.key}" data-week-index="${weekIndex}" data-day-index="${dayIndex}" style="--week-index: ${weekIndex}; --day-index: ${dayIndex};">
						<div class="heatmapCellTooltip">
							${dateStr}<br>
							${minutes > 0 ? `${minutes} min` : "Sem leitura"}
						</div>
					</div>
				`;
            }).join("");

            return `<div class="heatmapWeek">${weekHtml}</div>`;
        }).join("");

        const gridHtml = `
			<div class="heatmapWeekdays">${weekdaysHtml}</div>
			<div class="heatmapWeeks">${weeksHtml}</div>
		`;

        reader.util.loadElem("#heatmapGrid").innerHTML = gridHtml;

        // Animate heatmap cells
        setTimeout(() => {
            this.animateHeatmap();
        }, 200);
    }

    animateHeatmap() {
        const cells = document.querySelectorAll(".heatmapCell[data-level]");
        if (!cells || cells.length === 0 || !window.gsap) return;

        cells.forEach((cell, index) => {
            const level = parseInt(cell.getAttribute("data-level")) || 0;
            if (level === 0) return; // Skip empty cells

            cell.style.opacity = "0";
            cell.style.transform = "scale(0)";

            setTimeout(() => {
                if (window.gsap) {
                    window.gsap.to(cell, {
                        opacity: 1,
                        scale: 1,
                        duration: 0.3,
                        ease: "back.out(1.7)",
                        delay: index * 0.002
                    });
                }
            }, index * 5);
        });
    }

    setupStatsAnimations() {
        const target = reader.util.loadElem("#dayPeriodGraphic");
        if (!target) {
            return;
        }

        if (this.statsObserver) {
            this.statsObserver.disconnect();
        }

        this.statsObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.remove("animate");
                    void entry.target.offsetWidth;
                    entry.target.classList.add("animate");

                    // Animate calendar cells
                    this.animateCalendarCells();

                    // Animate word rows
                    this.animateWordRows();

                    // Animate day period bars
                    this.animateDayPeriodBars();
                } else {
                    entry.target.classList.remove("animate");
                }
            });
        }, { threshold: 0.35 });

        this.statsObserver.observe(target);
    }

    animateCalendarCells() {
        const cells = document.querySelectorAll(".calendarCell.active");
        if (!cells || cells.length === 0 || !window.gsap) return;

        cells.forEach((cell, index) => {
            cell.style.opacity = "0";
            cell.style.transform = "scale(0.8)";

            setTimeout(() => {
                if (window.gsap) {
                    window.gsap.to(cell, {
                        opacity: 1,
                        scale: 1,
                        duration: 0.3,
                        ease: "power2.out",
                        delay: index * 0.02
                    });

                    // Add subtle pulse to active cells
                    setTimeout(() => {
                        if (window.gsap && window.gsap.pulseOpacity) {
                            window.gsap.pulseOpacity(cell, {
                                minOpacity: 0.9,
                                duration: 2,
                                repeat: -1,
                                delay: index * 0.1
                            });
                        }
                    }, 300 + index * 20);
                }
            }, index * 30);
        });
    }

    animateWordRows() {
        const rows = document.querySelectorAll(".readingWordRow");
        if (!rows || rows.length === 0 || !window.gsap) return;

        rows.forEach((row, index) => {
            row.style.opacity = "0";
            row.style.transform = "translateX(-20px)";

            setTimeout(() => {
                if (window.gsap) {
                    window.gsap.to(row, {
                        opacity: 1,
                        x: 0,
                        duration: 0.4,
                        ease: "power2.out",
                        delay: index * 0.05
                    });
                }
            }, index * 50);
        });
    }

    animateDayPeriodBars() {
        const fills = document.querySelectorAll(".dayPeriodFill");
        if (!fills || fills.length === 0 || !window.gsap) return;

        fills.forEach((fill, index) => {
            const originalWidth = fill.style.width;
            fill.style.width = "0%";

            setTimeout(() => {
                if (window.gsap) {
                    window.gsap.to(fill, {
                        width: originalWidth,
                        duration: 1,
                        ease: "power2.out",
                        delay: index * 0.15
                    });

                    // Add pulse opacity effect to the best period
                    const row = fill.closest(".dayPeriodRow");
                    if (row && row.classList.contains("best")) {
                        setTimeout(() => {
                            if (window.gsap && window.gsap.pulseOpacity) {
                                window.gsap.pulseOpacity(fill, {
                                    minOpacity: 0.7,
                                    duration: 2,
                                    repeat: -1,
                                    delay: 0.5
                                });
                            }
                        }, 1000 + index * 150);
                    }
                }
            }, 200 + index * 100);
        });
    }

    getStreakForDate(date, days) {
        let streak = 0;
        const cursor = new Date(date);

        while (true) {
            const key = reader.util.getDateString(cursor);
            if (days[key] && days[key] > 0) {
                streak += 1;
                cursor.setDate(cursor.getDate() - 1);
                continue;
            }
            break;
        }

        return streak;
    }

    createAbout() {
        this.currentView = "about";
        this.resetContainer();
        reader.util.setTitle("Sobre - Leitor de epub Coentro");

        const container = reader.util.loadElem(".container");

        container.innerHTML = `
			<div class="aboutContainer">
				<img src="assets/logo.png" class="aboutLogo" draggable="false">
				<div class="aboutTitle">Leitor de epub Coentro: Criado por Thiago Freitas</div>
				<div class="aboutText">(C) 2026 Todos os direitos reservados.</div>
				<div class="settingsContainer" style="margin-top: 24px; width: 100%; max-width: 1100px;">
					<div class="settingsSection">
						<div class="settingsSectionTitle">Características de destaque do Leitor de epub Coentro</div>
						<div class="aboutText" style="text-align: left;">
							<ul style="margin: 0; padding-left: 22px; line-height: 1.7;">
								<li>Feito para ler em voz alta com o Immersive Reader presente no Microsoft Edge.</li>
								<li>Importe livros EPUB individualmente ou em lote diretamente de seu repositório ou por arquivo JSON criado com a própria extensão.</li>
								<li>Exporte facilmente sua coleção ou biblioteca por categoria ou na íntegra em formato JSON, CSV ou PDF.</li>
								<li>Leitura em tela padrão ou tela cheia, incluindo atalhos de fácil acesso como <strong>F</strong>.</li>
								<li>Caixa de pesquisa avançada para ir de página a página, navegar entre capítulos e buscar palavras-chave com expressões avançadas e filtros englobados.</li>
								<li>Fácil acesso e navegação entre o menu principal e o leitor com teclas de atalho como <strong>C</strong> e <strong>T</strong>.</li>
								<li>Outras teclas de atalho para experiência completa, como <strong>N</strong> e <strong>P</strong> para próxima e anterior, <strong>D</strong> e <strong>K</strong> para capítulo anterior e seguinte, <strong>B</strong> e <strong>E</strong> para início e fim, <strong>X</strong> para a caixa de pesquisa, entre outras.</li>
								<li>Explicação do uso de expressões regulares nas pesquisas.</li>
								<li>Destaque em cor verde-limão para busca por páginas através de seu número e azul-mirtilo para o resultado do capítulo em questão.</li>
								<li>Busca de capítulos por números cardinais, por extenso, ordinais, romanos e título em inglês dos Estados Unidos e português do Brasil.</li>
								<li>Animações engraçadas para troca da ordem de leitura priorizada por você, como reação da tropa não-envolvida.</li>
								<li>Visualização em grid ou lista.</li>
								<li>Personalização da cor da interface, da página, das setas e das métricas ABC, ABCDEF, ABCDEFFGHI e ABCDEFGHIJKL.</li>
								<li>Links das seções no índice navegam para seções ou capítulos correspondentes.</li>
								<li>Porcentagem do progresso alinhada ao título da seção em vigência.</li>
								<li>Ícone de bandeira quadriculada preta e branca ao atingir o fim e amarela e branca quando se volta páginas após concluir.</li>
								<li>Busca de novos livros no Z-Library.</li>
								<li>Tradução da interface para mais de 8 idiomas.</li>
								<li>Envio do livro lido ao Goodreads como atualização da jornada de leitura.</li>
								<li>E muito mais...</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		`;
    }

    createRegexHelp() {
        this.currentView = "regexHelp";
        this.resetContainer();
        reader.util.setTitle("Explicação das Regex - Leitor de epub Coentro");

        const container = reader.util.loadElem(".container");
        const regexFlags = [
            { flag: "g", description: "Global: encontra todas as ocorrências no texto." },
            { flag: "i", description: "Case-insensitive: ignora maiúsculas/minúsculas." },
            { flag: "m", description: "Multiline: ^ e $ passam a considerar início/fim de cada linha." },
            { flag: "s", description: "DotAll: o ponto (.) também casa quebras de linha." },
            { flag: "u", description: "Unicode: trata corretamente caracteres Unicode (acentos, símbolos)." },
            { flag: "y", description: "Sticky: continua buscando exatamente da posição atual." },
            { flag: "gi", description: "Combinação comum: global + sem distinção de caixa." },
            { flag: "gm", description: "Combinação comum: global + multiline." },
            { flag: "gim", description: "Combinação comum: global + case-insensitive + multiline." },
            { flag: "gs", description: "Combinação comum: global + dotAll." },
            { flag: "gu", description: "Combinação comum: global + Unicode." }
        ];
        const regexExamples = [
            {
                title: "Autor",
                pattern: "`about\\s+the\\s+author|sobre\\s+o\\s+autor`",
                flags: "`gi`",
                description: "Encontrar seção de autor.",
                example: "Exemplo real: localiza \"About the Author\" e \"Sobre o Autor\" no fim do ebook."
            },
            {
                title: "Editora",
                pattern: "`(?:publisher|editora)\\s*[:\\-]\\s*([\\w\\s&.,-]+)`",
                flags: "`gi`",
                description: "Capturar nome da editora.",
                example: "Exemplo real: encontra \"Editora: Companhia das Letras\" ou \"Publisher: Penguin Books\"."
            },
            {
                title: "ISBN",
                pattern: "`\\bISBN(?:-1[03])?[:\\s]*([0-9Xx\\-]{10,17})\\b`",
                flags: "`gi`",
                description: "Encontrar ISBN-10/13.",
                example: "Exemplo real: captura \"ISBN 978-85-359-0277-5\"."
            },
            {
                title: "ISSN",
                pattern: "`\\bISSN[:\\s]*\\d{4}-\\d{3}[\\dXx]\\b`",
                flags: "`gi`",
                description: "Encontrar ISSN.",
                example: "Exemplo real: encontra \"ISSN 2049-3630\"."
            },
            {
                title: "ASIN",
                pattern: "`\\bASIN[:\\s]*([A-Z0-9]{10})\\b`",
                flags: "`gi`",
                description: "Encontrar ASIN (Amazon).",
                example: "Exemplo real: captura \"ASIN B0C9XYZ123\"."
            },
            {
                title: "Código",
                pattern: "`\\b\\d{12,14}\\b`",
                flags: "`g`",
                description: "Números longos (código de barras/EAN).",
                example: "Exemplo real: encontra \"9788535902775\" em páginas de copyright/contracapa."
            },
            {
                title: "Datas",
                pattern: "`\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b|\\b\\d{4}\\b`",
                flags: "`g`",
                description: "Datas comuns.",
                example: "Exemplo real: captura \"08/09/1995\", \"1995\" e \"2026\"."
            },
            {
                title: "Personas",
                pattern: "`\\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)*\\b`",
                flags: "`gu`",
                description: "Nomes próprios simples.",
                example: "Exemplo real: encontra \"Luke Skywalker\", \"Darth Vader\", \"Stephen King\"."
            },
            {
                title: "Locais",
                pattern: "`\\b(?:Rua|Avenida|Av\\.?|Parque|Bairro|Cidade|Estado|País|Country|Planet|World)\\b[^,.\\n]*`",
                flags: "`gim`",
                description: "Parques, ruas, cidades e similares.",
                example: "Exemplo real: encontra \"Rua Augusta\", \"Cidade de São Paulo\", \"Planet Tatooine\"."
            },
            {
                title: "Telefone",
                pattern: "`\\+?\\d{1,3}?\\s*\\(?\\d{2,3}\\)?\\s*\\d{4,5}-?\\d{4}`",
                flags: "`g`",
                description: "Telefones BR/intl.",
                example: "Exemplo real: captura \"+55 (11) 98765-4321\"."
            },
            {
                title: "Diálogo",
                pattern: "`^\\s*(?:[-—]|\\\"|“).+`",
                flags: "`gm`",
                description: "Linhas de diálogo por travessão ou aspas.",
                example: "Exemplo real: encontra linhas como \"— Não confie nele.\" ou \"\\\"I am your father.\\\"\"."
            },
            {
                title: "Cultura pop",
                pattern: "`\\b(?:\\\"?Star\\s*Wars\\\"?|SW|Stephen\\s+King)\\b`",
                flags: "`gi`",
                description: "Demonstração com Star Wars, SW e Stephen King.",
                example: "Exemplo real: localiza \"Star Wars\", \"SW\" e \"Stephen King\" quando citados no texto."
            }
        ];

        container.innerHTML = `
			<div class="settingsContainer" style="max-width: 1100px;">
				<div class="settingsSection">
					<div class="settingsSectionTitle">Explicação das Regex</div>
					<div class="aboutText" style="text-align: left;">Resumo rápido das flags mais úteis e exemplos práticos para buscas em livros.</div>
				</div>
				<div class="settingsSection">
					<div class="settingsSectionTitle">Flags</div>
					<div class="shortcutsList">
						${regexFlags.map(item => `
							<div class="shortcutItem">
								<div class="shortcutKey">${item.flag}</div>
								<div class="shortcutCommand">${item.description}</div>
							</div>
						`).join("")}
					</div>
				</div>
				<div class="settingsSection">
					<div class="settingsSectionTitle">Exemplos práticos para livros</div>
					<div class="aboutText" style="text-align: left; display: grid; gap: 18px;">
						${regexExamples.map(item => `
							<div style="padding: 16px 18px; border: 1px solid var(--sidebar-border); border-radius: 14px; background: rgba(255,255,255,0.03);">
								<div style="font-weight: 700; margin-bottom: 8px;">${item.title}</div>
								<div style="margin-bottom: 6px;">${item.description} <strong>(use ${item.flags})</strong>.</div>
								<div style="margin-bottom: 6px; word-break: break-word;"><code>${item.pattern.slice(1, -1)}</code></div>
								<div>${item.example}</div>
							</div>
						`).join("")}
					</div>
				</div>
			</div>
		`;
    }

    createShortcuts() {
        this.currentView = "shortcuts";
        this.resetContainer();
        reader.util.setTitle("Atalhos - Leitor de epub Coentro");

        const container = reader.util.loadElem(".container");
        const shortcuts = [
            { key: "N", label: "Próxima página (ou próxima visualização de 2 páginas)" },
            { key: "P", label: "Página anterior" },
            { key: "K", label: "Próximo capítulo" },
            { key: "D", label: "Capítulo anterior" },
            { key: "E", label: "Ir para o fim do livro" },
            { key: "B", label: "Ir para o início do livro" },
            { key: "C", label: "Voltar à tela de capas" },
            { key: "T", label: "Voltar à leitura a partir do progresso salvo" },
            { key: "F", label: "Tela cheia" }
        ];

        container.innerHTML = `
			<div class="settingsContainer shortcutsContainer">
				<div class="settingsSection">
					<div class="settingsSectionTitle">Atalhos de teclado</div>
					<div class="shortcutsList">
						${shortcuts.map(shortcut => `
							<div class="shortcutItem">
								<div class="shortcutKey">${shortcut.key}</div>
								<div class="shortcutCommand">${shortcut.label}</div>
							</div>
						`).join("")}
					</div>
				</div>
			</div>
		`;
    }

    createReader() {
        this.currentView = "reader";
        document.body.classList.add("reader-view-active");
        if (reader.renderer.readerStylesheet) {
            reader.renderer.readerStylesheet.remove();
        }
        this.container.clear();

        const readerElem = reader.util.createElement("div", this.container).setAttributes({ id: "reader" });

        const readerOverlay = reader.util.createElement("div", this.container).setAttributes({ id: "readerOverlay" });

        readerOverlay.innerHTML = `
			<div id="readerOverlayTop">
				<div id="readerOverlayTopLeft">
					<button class="overlayButton" id="overlayButtonBack" title="Voltar à biblioteca"><img src="assets/back.png"></button>
				</div>
				<div id="readerOverlayTopText"></div>
				<div id="readerOverlayTopRight">
					<button class="overlayButton" id="overlayButtonTOC" title="Sumário"><img src="assets/list.png"></button>
					<button class="overlayButton" id="overlayButtonInfo" title="Informações do livro"><img src="assets/info2.png"></button>
					<button class="overlayButton" id="overlayButtonTranslateToggle" title="Alternar original/tradução"><img src="assets/translate icon.png"></button>
					<button class="overlayButton" id="overlayButtonTranslationHistory" title="Histórico de traduções"><img src="assets/translation-history.png"></button>
					<button class="overlayButton" id="overlayButtonDictionary" title="Dicionário"><img src="assets/text-font.png"></button>
					<button class="overlayButton" id="overlayButtonSettings" title="Configurações"><img src="assets/cog.png"></button>
					<button class="overlayButton" id="overlayButtonFullscreen" title="Tela cheia"><img src="assets/fullscreen.png"></button>
				</div>
			</div>
			<div id="readerOverlayBottom">
				<div id="overlayProgress">
					<div id="progressMarker"></div>
				</div>
			</div>
			<div id="readerOverlaySmall">
				<div></div>
			</div>
			<div id="readerNavLeft" class="readerNavEdge" role="button" aria-label="PÃ¡gina anterior" title="PÃ¡gina anterior">
				<img src="assets/previous.png" draggable="false">
			</div>
			<div id="readerNavRight" class="readerNavEdge" role="button" aria-label="PrÃ³xima pÃ¡gina" title="PrÃ³xima pÃ¡gina">
				<img src="assets/next.png" draggable="false">
			</div>
			<div id="readerLoading">
				<div id="loadingAnimation"></div>
			</div>
			<div id="overlayTooltip"></div>
			<div id="readerSearchBox" role="dialog" aria-modal="false" aria-label="Busca do leitor">
				<div class="readerSearchHeader">
					<div class="readerSearchHeading">
						<div class="readerSearchTitle">Busca do leitor</div>
						<div class="readerSearchSubtitle">Pesquisa flexivel por termos, regex, paginas e capitulos.</div>
					</div>
					<button id="readerSearchClose" type="button" aria-label="Fechar busca">×</button>
				</div>
				<div class="readerSearchPanel">
					<div class="readerSearchRow readerSearchMainRow">
					<input id="readerSearchInput" type="text" placeholder="Palavra-chave, regex, número, ordinal ou romano">
					<div class="settingsSelectWrap readerSearchModeWrap">
						<select id="readerSearchMode" class="settingsSelect">
							<option value="keyword">Palavra-chave</option>
							<option value="regex">Regex</option>
						</select>
						<span class="settingsSelectChevron" aria-hidden="true">▼</span>
					</div>
					<input id="readerSearchFlags" type="text" value="giu" placeholder="Flags">
					<button id="readerSearchRun" type="button">Buscar</button>
					<button id="readerSearchPrev" type="button" aria-label="Resultado anterior">◀</button>
					<button id="readerSearchNext" type="button" aria-label="Próximo resultado">▶</button>
				</div>
					<div class="readerSearchRow readerSearchAuxRow">
						<div id="readerSearchStatus">Sem resultados</div>
					</div>
				</div>
				<div id="readerSearchResults"></div>
			</div>
		`;

        // Keep overlays out of Immersive Reader flow so it doesn't stop on footer/header text
        readerOverlay.setAttribute("aria-hidden", "true");
        readerOverlay.setAttribute("data-immersive-reader-ignore", "true");
        readerOverlay.setAttribute("role", "presentation");
        readerOverlay.querySelectorAll("*").forEach(elem => {
            elem.setAttribute("aria-hidden", "true");
            elem.setAttribute("data-immersive-reader-ignore", "true");
            elem.setAttribute("role", "presentation");
        });

        reader.util.loadElem("#overlayButtonBack").addEventListener("click", () => this.createLibrary());
        reader.util.loadElem("#overlayButtonInfo").addEventListener("click", () => this.openInfoBox(reader.renderer.book.title));
        reader.util.loadElem("#overlayButtonTranslateToggle").addEventListener("click", async () => {
            const current = (await reader.store.loadSetting("readerShowTranslatedText")) !== false;
            await reader.store.updateSetting("readerShowTranslatedText", !current);
            await this.reloadReaderAfterTranslationSettingsChanged();
        });
        reader.util.loadElem("#overlayButtonTranslationHistory").addEventListener("click", () => this.openTranslationHistoryBox());
        reader.util.loadElem("#overlayButtonDictionary").addEventListener("click", () => this.openDictionaryLookup());
        reader.util.loadElem("#overlayButtonSettings").addEventListener("click", () => this.openSettingsBox());
        reader.util.loadElem("#overlayButtonTOC").addEventListener("click", () => this.openTOCBox(reader.renderer.book.tableOfContents));
        reader.util.loadElem("#overlayButtonFullscreen").addEventListener("click", () => reader.renderer.toggleFullscreen());

        return { reader: readerElem, overlay: readerOverlay };
    }

    async shouldReturnWithSearchBox() {
        return (await reader.store.loadSetting("returnWithSearchBox")) !== false;
    }

    getReaderSearchState(title) {
        const normalizedTitle = String(title || "").trim();
        if (!normalizedTitle) {
            return null;
        }
        return this.readerSearchStateByTitle.get(normalizedTitle) || null;
    }

    saveReaderSearchState(title, state) {
        const normalizedTitle = String(title || "").trim();
        if (!normalizedTitle) {
            return;
        }
        if (!state || typeof state !== "object") {
            this.readerSearchStateByTitle.delete(normalizedTitle);
            return;
        }
        this.readerSearchStateByTitle.set(normalizedTitle, { ...state });
    }

    loadTheme(theme) {
        // remove all existing theme stylesheets
        reader.util.loadAllElems("link")
            .filter(elem => /css\/theme-\w+?.css/.test(elem.href))
            .forEach(elem => elem.remove());

        reader.util.loadStylesheet(`css/theme-${theme}.css`);
        void this.applyInterfaceColorFromSettings();
    }

    getLength(count) {
        const kilobytes = Math.ceil(count / 1000);

        if (kilobytes >= 1000) {
            const megabytes = kilobytes / 1000;
            return `${Math.round(megabytes * 10) / 10} MB`;
        }

        return `${kilobytes} KB`;
    }

    async loadBook(title) {
        if (this.openingBook) {
            return;
        }
        this.openingBook = true;
        try {
            let book = await reader.store.loadBook(title);
            if (!book || !Array.isArray(book.contents) || !book.contents.length) {
                throw new Error(`Livro nao encontrado no armazenamento: ${title}`);
            }
            await reader.bookLoaded(book);
            this.readerOpenedAt = Date.now();
        } catch (err) {
            console.error("Erro ao abrir livro.", err);
            await this.createLibrary();
            const reason = err && err.message ? String(err.message) : "erro interno";
            alert(`Nao foi possivel abrir este livro nesta sessao. Motivo: ${reason}`);
        } finally {
            this.openingBook = false;
        }
    }

    async addBook(input) {
        if (!input || !input.files || !input.files.length) {
            return;
        }
        try {
            await reader.fileLoaded(input.files, { openLast: true });
        } catch (error) {
            console.error("Erro ao importar livro.", error);
            const reason = error && error.message ? String(error.message) : "erro interno";
            alert(`Não foi possível importar o livro. Motivo: ${reason}`);
        } finally {
            input.value = "";
            if (this.currentView === "library") {
                this.currentlyRendering = false;
                await this.renderBooks();
            }
        }
    }

    createInfoBox(html, title) {
        reader.util.loadAllElems("#infoBoxContainer").forEach(elem => elem.remove());
        const infoBoxContainer = reader.util.createElement("div", this.container).setAttributes({ id: "infoBoxContainer" });
        const infoBox = reader.util.createElement("div", infoBoxContainer).setAttributes({
            id: "infoBox"
        });

        infoBox.innerHTML = `
			${title ? `<div class="infoBoxItem">
				<span class="infoBoxItemTitle">${title}</span>
				<span id="infoBoxButtonClose"><img src="assets/close.png" draggable="false"></span>
			</div>` : ""}${html}
		`;

        if (title) {
            infoBox.querySelector("#infoBoxButtonClose").addEventListener("click", () => infoBoxContainer.remove());
        }
    }

    async openInfoBox(title) {
        const book = await reader.store.loadBook(title);

        let html = `
			<div class="infoBoxItem">
				<span class="infoBoxItemTitle">Título</span>
				<span>${title}</span>

				
					</div>
				</div>
			</div>
		`;

        for (const [key, value] of Object.entries(book.attributes)) {
            html += `
				<div class="infoBoxItem">
					<span class="infoBoxItemTitle">${key}</span>
					<span>${value}</span>
				</div>
			`;
        }

        this.createInfoBox(html, "Informações do livro");
    }

    openTOCBox(toc) {
        const html = toc.length ? toc.map(item => `
			<div class="infoBoxItem tocElem" data-filename="${item.content}">
				<span style="margin-left: ${item.indentation * 20}px; pointer-events: none;">${item.title}</span>
			</div>
		`).join("") : `<div class="infoBoxItem">Este livro não possui sumário.</div>`;

        this.createInfoBox(html, "Sumário");

        reader.util.loadAllElems(".tocElem").forEach(elem => elem.addEventListener("click", async event => {
            const chapter = reader.renderer.book.contents.find(item => item.filename === event.target.dataset.filename);
            if (chapter) {
                const idx = reader.renderer.book.contents.indexOf(chapter);
                await reader.renderer.goToChapter(idx, 0);
                reader.util.loadElem("#infoBoxContainer").remove();
            }
        }));
    }

    openSettingsBox() {
        this.createInfoBox(`
			<div id="settingsInfoBox"></div>
		`, "Configurações");

        this.createSettings(reader.util.loadElem("#settingsInfoBox"));
    }

    async openDictionaryLookup() {
        const selection = window.getSelection && window.getSelection();
        let rawWord = "";
        if (selection && selection.toString) {
            rawWord = String(selection.toString() || "").trim();
        }
        if (!rawWord && reader?.renderer?.getSelectionWordSnapshot) {
            const snapshot = reader.renderer.getSelectionWordSnapshot(selection);
            rawWord = snapshot?.word || snapshot?.normalizedWord || "";
        }
        const normalizedWord = reader?.renderer?.normalizeWord
            ? reader.renderer.normalizeWord(rawWord)
            : String(rawWord || "").toLowerCase().replace(/(^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$)/gu, "");
        if (!normalizedWord) {
            this.createInfoBox(`
				<div class="infoBoxItem">
					<span>Selecione uma palavra no texto para consultar o dicionário.</span>
				</div>
			`, "Dicionário");
            return;
        }

        const apiKey = String((await reader.store.loadSetting("merriamWebsterApiKey")) || "").trim();
        if (!apiKey) {
            this.createInfoBox(`
				<div class="infoBoxItem">
					<span>Adicione sua chave Merriam-Webster em Configurações para usar o dicionário.</span>
				</div>
			`, `Dicionário: ${normalizedWord}`);
            return;
        }

        this.createInfoBox(`
			<div class="infoBoxItem">
				<span class="infoBoxItemTitle">Pesquisa: ${normalizedWord}</span>
			</div>
			<div class="infoBoxItem" id="dictionaryLookupStatus">Consultando Merriam-Webster...</div>
			<div class="infoBoxItem" id="dictionaryLookupResult"></div>
		`, `Dicionário: ${normalizedWord}`);

        const statusElem = reader.util.loadElem("#dictionaryLookupStatus");
        const resultElem = reader.util.loadElem("#dictionaryLookupResult");
        const setStatus = text => {
            if (statusElem) statusElem.textContent = text || "";
        };
        const setResult = html => {
            if (resultElem) resultElem.innerHTML = html || "";
        };

        try {
            const endpoint = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(normalizedWord)}?key=${encodeURIComponent(apiKey)}`;
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            if (!Array.isArray(payload) || !payload.length) {
                setStatus("Nenhum resultado encontrado.");
                return;
            }
            if (typeof payload[0] === "string") {
                setStatus("Nenhuma definição exata. Sugestões:");
                setResult(`<div>${payload.slice(0, 8).map(item => `<span class="dictionarySuggestion">${item}</span>`).join(" ")}</div>`);
                return;
            }
            const entry = payload.find(item => item && typeof item === "object" && Array.isArray(item.shortdef) && item.shortdef.length);
            if (!entry) {
                setStatus("Nenhuma definição curta encontrada.");
                return;
            }
            const englishDef = entry.shortdef.slice(0, 3).join("; ");
            setStatus("");
            let translated = "";
            try {
                translated = await reader.util.translateText(englishDef, "pt-BR");
            } catch (_error) {}
            setResult(`
				<div><strong>EN:</strong> ${englishDef}</div>
				${translated ? `<div><strong>PT-BR:</strong> ${translated}</div>` : ""}
			`);
        } catch (_error) {
            setStatus("Falha ao consultar o dicionário agora. Tente novamente.");
        }
    }

    async handleCompletionFlagAction(title) {
        const action = await this.openCompletionFlagActionDialog(title);
        if (!action) {
            return;
        }
        const bookRecord = await reader.store.loadBook(title);
        const positionTarget = bookRecord || title;
        const current = await reader.store.loadPosition(positionTarget);
        if (action === "fresh") {
            await reader.store.setPosition(positionTarget, 0, 0, 0, 0, 0, 0, 0);
        } else if (action === "progress") {
            const chapter = Math.max(0, Number(current?.chapter) || 0);
            const anchor = Math.max(0, Number(current?.anchor) || 0);
            const page = Math.max(0, Number(current?.page) || 0);
            const globalAnchor = Math.max(0, Number(current?.globalAnchor) || anchor);
            const chapterGlobalAnchor = Math.max(0, Number(current?.chapterGlobalAnchor) || globalAnchor);
            const percentage = Math.max(0, Math.min(94.99, this.parsePercentage(current?.percentage)));
            const pagePercentageRaw = Number(current?.pagePercentage);
            const pagePercentage = Number.isFinite(pagePercentageRaw)
                ? Math.max(0, Math.min(94.99, pagePercentageRaw))
                : percentage;
            await reader.store.setPosition(positionTarget, chapter, anchor, percentage, page, globalAnchor, chapterGlobalAnchor, pagePercentage);
        }
        await reader.store.setBookStatus(title, "reading");
        await this.renderBooks();
    }

    openCompletionFlagActionDialog(title) {
        return new Promise(resolve => {
            let settled = false;
            const settle = value => {
                if (settled) return;
                settled = true;
                reader.util.loadElem("#infoBoxContainer")?.remove();
                resolve(value);
            };

            this.createInfoBox(`
				<div class="infoBoxItem">
					<span>Este livro foi marcado como concluído. Como deseja continuar?</span>
				</div>
				<div class="completionFlagActions">
					<button id="completionFlagStartFresh" type="button">Recomeçar do zero</button>
					<button id="completionFlagStartProgress" type="button">Retomar do progresso</button>
					<button id="completionFlagCancel" type="button">Cancelar</button>
				</div>
			`, `Conclusão: ${title}`);

            reader.util.loadElem("#completionFlagStartFresh")?.addEventListener("click", () => settle("fresh"));
            reader.util.loadElem("#completionFlagStartProgress")?.addEventListener("click", () => settle("progress"));
            reader.util.loadElem("#completionFlagCancel")?.addEventListener("click", () => settle(null));
            reader.util.loadElem("#infoBoxButtonClose")?.addEventListener("click", () => settle(null));
        });
    }

    playPodiumSound(rank) {
        const podiumRank = Number(rank);
        const src = podiumRank === 1
            ? ["assets/1st-tadaa.mp3", "assets/dragon-studio-wow-423653.mp3"]
            : podiumRank === 2
                ? "assets/2nd-tada-fanfare.mp3"
                : podiumRank === 3
                    ? "assets/3rd-tadaa-trumpet.mp3"
                    : "";
        const playlist = Array.isArray(src) ? src : src ? [src] : [];
        if (!playlist.length) {
            return;
        }
        try {
            const playNext = index => {
                const clip = playlist[index];
                if (!clip) {
                    return;
                }
                const audio = new Audio(clip);
                audio.volume = 0.9;
                audio.addEventListener("ended", () => playNext(index + 1), { once: true });
                void audio.play();
            };
            playNext(0);
        } catch (_error) {}
    }

    playLastPlaceSound() {
        try {
            const audio = new Audio("assets/sad-trumpet.mp3");
            audio.volume = 0.85;
            void audio.play();
        } catch (_error) {}
    }

    async reloadReaderAfterTranslationSettingsChanged() {
        if (this.currentView !== "reader" || !reader?.renderer?.book) {
            return;
        }
        if ((Date.now() - this.readerOpenedAt) < 1500) {
            return;
        }
        if (this.openingBook || reader?.bookOpenInFlight) {
            this.readerReloadQueued = true;
            return;
        }
        const book = reader.renderer.book;
        const reloadSignature = JSON.stringify({
            title: String(book?.title || "").trim(),
            preferredLanguage: await reader.store.loadSetting("preferredLanguage"),
            translateBooks: await reader.store.loadSetting("translateBooks"),
            translationProvider: await reader.store.loadSetting("translationProvider"),
            readerShowTranslatedText: await reader.store.loadSetting("readerShowTranslatedText")
        });
        const now = Date.now();
        if (reloadSignature === this.readerReloadLastSignature && (now - this.readerReloadLastAt) < 1200) {
            return;
        }
        if (this.readerReloadInFlight) {
            this.readerReloadQueued = true;
            return;
        }
        this.readerReloadInFlight = true;
        this.readerReloadLastSignature = reloadSignature;
        this.readerReloadLastAt = now;
        try {
            await reader.renderer.persistReadingState?.();
            await reader.bookLoaded(book);
        } catch (_error) {
        } finally {
            this.readerReloadInFlight = false;
            if (this.readerReloadQueued) {
                this.readerReloadQueued = false;
                await this.reloadReaderAfterTranslationSettingsChanged();
            }
        }
    }

    async getCurrentTranslationHistorySnapshot() {
        const book = reader?.renderer?.book;
        if (!book || !Array.isArray(book.contents) || !book.contents.length) {
            return { enabled: false };
        }

        const storageBookKey = `library-${String(book.title || "").replaceAll(/[^\w]/g, "")}`;
        const runtimeSnapshot = await new Promise(resolve => {
            if (!chrome?.runtime?.sendMessage) {
                resolve(null);
                return;
            }
            chrome.runtime.sendMessage({ action: "translationQueueSnapshot" }, response => {
                if (chrome.runtime.lastError || !response?.success) {
                    resolve(null);
                    return;
                }
                resolve({
                    jobs: response.jobs || {},
                    queue: response.queue || []
                });
            });
        });

        const jobsMap = runtimeSnapshot?.jobs || (await reader.store.get("translationJobsV1")) || {};
        const queue = runtimeSnapshot?.queue || (await reader.store.get("translationQueueV1")) || [];
        const jobs = Object.values(jobsMap || {}).filter(Boolean);
        const preferredLanguage = reader.util.normalizeLanguageCode((await reader.store.loadSetting("preferredLanguage")) || "pt");
        const matchingJobs = jobs.filter(job => {
            const sameStorageKey = String(job?.bookStorageKey || "").trim() === storageBookKey;
            const sameTitle = String(job?.title || "").trim() === String(book.title || "").trim();
            return sameStorageKey || sameTitle;
        });
        if (!matchingJobs.length) {
            return { enabled: false };
        }

        const currentJob = matchingJobs.sort((a, b) =>
            (reader.util.normalizeLanguageCode(b?.targetLanguage || "") === preferredLanguage ? 1 : 0)
            - (reader.util.normalizeLanguageCode(a?.targetLanguage || "") === preferredLanguage ? 1 : 0)
            || (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0)
            || (Number(b?.progress) || 0) - (Number(a?.progress) || 0)
        )[0];

        const translationStorageKey = String(currentJob?.storageKey || "").trim();
        const persisted = translationStorageKey ? ((await reader.store.get(translationStorageKey)) || {}) : {};
        const persistedChapters = Array.isArray(persisted?.chapters) ? persisted.chapters : [];
        const total = Math.max(1, Number(currentJob?.totalChapters) || book.contents.length || 1);
        const startChapter = Math.max(0, Math.min(total, Number(currentJob?.startChapter) || 0));
        const currentChapterIndex = Math.max(0, (Number(currentJob?.currentChapter) || 1) - 1);
        const skippedErrorIndexes = [...new Set(
            (Array.isArray(currentJob?.skippedErrorChapterIndexes) ? currentJob.skippedErrorChapterIndexes : [])
                .map(index => Number(index))
                .filter(index => Number.isInteger(index) && index >= startChapter)
        )];

        const doneIndexes = [];
        const pendingDetails = [];
        const runningDetails = [];
        for (let i = startChapter; i < total; i++) {
            const sourceHtml = String(book.contents?.[i]?.innerHTML || "");
            const entry = persistedChapters[i];
            const translated = typeof entry?.translated === "string" ? String(entry.translated) : "";
            const sameAsOriginal = translated && translated === sourceHtml;
            const hasTranslation = translated.trim().length > 0 && !sameAsOriginal;
            if (hasTranslation) {
                doneIndexes.push(i);
                continue;
            }
            if (skippedErrorIndexes.includes(i)) {
                pendingDetails.push({ chapter: i, state: "error", etaMs: 0 });
                continue;
            }
            if (String(currentJob?.status || "") === "running" && i === currentChapterIndex) {
                runningDetails.push({ chapter: i, etaMs: 0 });
                continue;
            }
            if (Number(currentJob?.scheduledAt) > Date.now()) {
                pendingDetails.push({ chapter: i, state: "retrying", etaMs: Number(currentJob.scheduledAt) - Date.now() });
            } else {
                pendingDetails.push({ chapter: i, state: queue.includes(currentJob.id) ? "queued" : "queued", etaMs: 0 });
            }
        }

        return {
            enabled: true,
            targetLanguage: String(currentJob?.targetLanguage || preferredLanguage || "pt"),
            total,
            done: doneIndexes.length,
            doneIndexes,
            pendingDetails,
            runningDetails
        };
    }

    async openTranslationHistoryBox() {
        const initial = await this.getCurrentTranslationHistorySnapshot();
        if (!initial?.enabled) {
            this.createInfoBox(`
				<div class="infoBoxItem">
					<span class="infoBoxItemTitle">Hist?rico indispon?vel</span>
					<span>Abra um livro com tradu??o ativa para ver o hist?rico.</span>
				</div>
			`, "Hist?rico de tradu??es");
            return;
        }

        const formatMmSs = ms => {
            const totalSec = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
            const mm = Math.floor(totalSec / 60);
            const ss = totalSec % 60;
            return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        };
        const formatSimpleList = indexes => {
            if (!indexes || !indexes.length) {
                return `<div class="translationHistoryLogItem empty">?</div>`;
            }
            return indexes.slice(0, 120).map(i => `<div class="translationHistoryLogItem">Cap?tulo ${i + 1}</div>`).join("");
        };
        const formatPendingList = details => {
            if (!details || !details.length) {
                return `<div class="translationHistoryLogItem empty">?</div>`;
            }
            return details.slice(0, 120).map(entry => {
                const chapter = Number(entry.chapter) + 1;
                if (entry.state === "queued") {
                    return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? em fila (${formatMmSs(entry.etaMs)})</div>`;
                }
                if (entry.state === "retrying") {
                    return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? inicia em ${formatMmSs(entry.etaMs)}</div>`;
                }
                return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? erro ao traduzir</div>`;
            }).join("");
        };
        const formatRunningList = snapshot => {
            const running = snapshot.runningDetails || [];
            const retrying = (snapshot.pendingDetails || []).filter(item => item.state === "retrying");
            const errored = (snapshot.pendingDetails || []).filter(item => item.state === "error");
            const merged = [
                ...running.map(item => ({ kind: "running", ...item })),
                ...retrying.map(item => ({ kind: "retrying", ...item })),
                ...errored.map(item => ({ kind: "error", ...item }))
            ];
            if (!merged.length) {
                return `<div class="translationHistoryLogItem empty">?</div>`;
            }
            return merged.slice(0, 120).map(entry => {
                const chapter = Number(entry.chapter) + 1;
                if (entry.kind === "running") {
                    return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? ETA ${formatMmSs(entry.etaMs)}</div>`;
                }
                if (entry.kind === "retrying") {
                    return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? em fila (${formatMmSs(entry.etaMs)})</div>`;
                }
                return `<div class="translationHistoryLogItem">Cap?tulo ${chapter} ? erro ao traduzir</div>`;
            }).join("");
        };

        this.createInfoBox(`<div id="translationHistoryBoardHost"></div>`, "Hist?rico de tradu??es");

        const renderBoard = async () => {
            const host = reader.util.loadElem("#translationHistoryBoardHost");
            if (!host) {
                window.clearInterval(this.translationHistoryRefreshTimer);
                this.translationHistoryRefreshTimer = null;
                return;
            }
            const snapshot = await this.getCurrentTranslationHistorySnapshot();
            if (!snapshot?.enabled) {
                host.innerHTML = `<div class="translationHistoryLogItem empty">Hist?rico indispon?vel no momento.</div>`;
                return;
            }
            const isComplete = snapshot.done >= snapshot.total && snapshot.total > 0;
            const boardClass = isComplete ? "complete" : "inprogress";
            host.innerHTML = `
				<div class="translationHistoryBoard ${boardClass}">
					<div class="translationHistoryHeader">
						<div class="translationHistoryMeta">Idioma-alvo: ${String(snapshot.targetLanguage || "").toUpperCase()}</div>
						<div class="translationHistoryMeta">Conclu?do: ${snapshot.done}/${snapshot.total}</div>
					</div>
					<div class="translationHistoryKanban">
						<div class="translationHistoryColumn">
							<div class="translationHistoryColumnTitle">Pendente/N?o iniciado</div>
							<div class="translationHistoryLogs">${formatPendingList((snapshot.pendingDetails || []).filter(item => item.state !== "error"))}</div>
						</div>
						<div class="translationHistoryColumn">
							<div class="translationHistoryColumnTitle">Em Progresso/Traduzindo</div>
							<div class="translationHistoryLogs">${formatRunningList(snapshot)}</div>
						</div>
						<div class="translationHistoryColumn">
							<div class="translationHistoryColumnTitle">Conclu?do/Pronto para Ler</div>
							<div class="translationHistoryLogs">${formatSimpleList(snapshot.doneIndexes || [])}</div>
						</div>
					</div>
				</div>
			`;
        };

        window.clearInterval(this.translationHistoryRefreshTimer);
        this.translationHistoryRefreshTimer = window.setInterval(() => {
            void renderBoard();
        }, 1000);
        await renderBoard();
    }

    openDeleteDialog(title) {
        this.createInfoBox(`
			<div id="deleteDialog">
				<div id="deleteText">Tem certeza de que deseja excluir <i>${title}</i>?</div>
				<div id="deleteButtons">
					<button id="cancelDeleteButton">Cancelar</button>
					<button id="deleteBookButton">Excluir</button>
				</div>
			</div>
		`);

        reader.util.loadElem("#deleteBookButton").addEventListener("click", async () => {
            await reader.store.removeFromLibrary(title);
            this.createLibrary();
        });

        reader.util.loadElem("#cancelDeleteButton").addEventListener("click", () => reader.util.loadElem("#infoBoxContainer").remove());
    }

    setupDragAndDrop() {
        const books = reader.util.loadAllElems(".draggable-book");
        const scrollContainer = reader.util.loadElem(".container");
        const interfaceRef = this;
        const COVER_TONE_THRESHOLDS = {
            blackLightness: 0.18,
            whiteLightness: 0.82,
            maxSaturation: 0.18
        };
        let draggedBook = null;
        let draggedIndex = -1;
        let draggedStatus = null;
        let hoverTimeout = null;
        let lastScrollTime = 0;
        const smileyMouths = [
            "assets/smiley mouth(1).png",
            "assets/smiley mouth(2).png",
            "assets/smiley mouth(3).png",
            "assets/smiley mouth(4).png",
            "assets/smiley mouth(5).png",
            "assets/smiley mouth(6) .png",
            "assets/smiley mouth(7) .png",
            "assets/smiley mouth(8) .png",
            "assets/smiley mouth(9).png",
            "assets/smiley mouth(10).png",
            "assets/smiley mouth(11).png",
            "assets/smiley mouth(12).png",
            "assets/smiley mouth(13).png",
            "assets/smiley mouth(14).png"
        ];

        const clearSmileyMouths = () => {
            reader.util.loadAllElems(".smiley-mouth-overlay").forEach(elem => elem.remove());
        };

        const showSmileyMouths = (excludeBooks = []) => {
            clearSmileyMouths();
            const excludeSet = new Set(excludeBooks);
            const candidates = reader.util.loadAllElems(".draggable-book")
                .filter(book => !excludeSet.has(book))
                .slice(0, 14);
            candidates.forEach((book, idx) => {
                const cover = book.querySelector(".libraryGridImage") || book.querySelector(".libraryImage");
                if (!cover) return;
                const img = document.createElement("img");
                img.className = "smiley-mouth-overlay";
                img.src = smileyMouths[idx % smileyMouths.length];
                img.setAttribute("alt", "");
                cover.appendChild(img);
                window.setTimeout(() => {
                    if (img && img.parentElement) img.remove();
                }, 2600);
            });
        };

        const ensurePodiumCrown = (bookElem, index) => {
            const cover = bookElem.querySelector(".libraryGridImage") || bookElem.querySelector(".libraryImage");
            if (!cover) {
                return;
            }
            const existingCrown = cover.querySelector(".podium-crown");
            const triggerCrownAnimation = crownElem => {
                if (!crownElem) return;
                crownElem.classList.remove("podium-crown-animate");
                void crownElem.offsetWidth;
                crownElem.classList.add("podium-crown-animate");
                window.clearTimeout(crownElem.__podiumAnimTimer);
                crownElem.__podiumAnimTimer = window.setTimeout(() => {
                    crownElem.classList.remove("podium-crown-animate");
                }, 5000);
            };
            if (index === 0) {
                if (!existingCrown) {
                    const crown = document.createElement("img");
                    crown.className = "podium-crown";
                    crown.src = "assets/1st-royal-crown.png";
                    crown.setAttribute("alt", "");
                    cover.appendChild(crown);
                    triggerCrownAnimation(crown);
                } else {
                    triggerCrownAnimation(existingCrown);
                }
            } else if (existingCrown) {
                existingCrown.remove();
            }
        };

        const getCoverTone = async bookElem => {
            try {
                const image = bookElem?.querySelector?.(".libraryGridImage img, .libraryImage img");
                if (!image || !image.naturalWidth || !image.naturalHeight) {
                    return "other";
                }
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (!context) {
                    return "other";
                }
                const sampleSize = 24;
                canvas.width = sampleSize;
                canvas.height = sampleSize;
                context.drawImage(image, 0, 0, sampleSize, sampleSize);
                const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
                let lightnessSum = 0;
                let saturationSum = 0;
                let counted = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3] / 255;
                    if (alpha < 0.1) continue;
                    const r = data[i] / 255;
                    const g = data[i + 1] / 255;
                    const b = data[i + 2] / 255;
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const lightness = (max + min) / 2;
                    const delta = max - min;
                    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1) || 1);
                    lightnessSum += lightness;
                    saturationSum += saturation;
                    counted += 1;
                }
                if (!counted) {
                    return "other";
                }
                const avgLightness = lightnessSum / counted;
                const avgSaturation = saturationSum / counted;
                if (avgLightness <= COVER_TONE_THRESHOLDS.blackLightness && avgSaturation <= COVER_TONE_THRESHOLDS.maxSaturation) {
                    return "black";
                }
                if (avgLightness >= COVER_TONE_THRESHOLDS.whiteLightness && avgSaturation <= COVER_TONE_THRESHOLDS.maxSaturation) {
                    return "white";
                }
            } catch (_error) {}
            return "other";
        };

        // Auto-scroll function during drag
        const handleAutoScroll = (e) => {
            if (!draggedBook || !scrollContainer) return;

            const now = Date.now();
            // Throttle scroll updates to ~60fps
            if (now - lastScrollTime < 16) return;
            lastScrollTime = now;

            const containerRect = scrollContainer.getBoundingClientRect();
            const mouseY = e.clientY;
            const scrollThreshold = 80; // Distance from edge to trigger scroll (in pixels)
            const maxScrollSpeed = 15; // Maximum pixels to scroll per update

            // Check if mouse is near top edge
            if (mouseY - containerRect.top < scrollThreshold && scrollContainer.scrollTop > 0) {
                const distanceFromEdge = mouseY - containerRect.top;
                const scrollAmount = Math.min(maxScrollSpeed, (scrollThreshold - distanceFromEdge) / scrollThreshold * maxScrollSpeed);
                scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollAmount);
            }
            // Check if mouse is near bottom edge
            else if (containerRect.bottom - mouseY < scrollThreshold) {
                const distanceFromEdge = containerRect.bottom - mouseY;
                const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
                const scrollAmount = Math.min(maxScrollSpeed, (scrollThreshold - distanceFromEdge) / scrollThreshold * maxScrollSpeed);
                scrollContainer.scrollTop = Math.min(maxScroll, scrollContainer.scrollTop + scrollAmount);
            }
        };

        books.forEach((book, index) => {
            // Drag start
            book.addEventListener("dragstart", async (e) => {
                draggedBook = book;
                draggedIndex = parseInt(book.dataset.bookIndex);
                draggedStatus = book.dataset.bookStatus || "want";
                book.classList.add("dragging");
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/html", book.outerHTML);

                // Make other books with the same status shake
                books.forEach((otherBook, otherIndex) => {
                    if (otherIndex !== draggedIndex) {
                        const otherStatus = otherBook.dataset.bookStatus || "want";
                        // Only shake books with the same status (read can swap with read, reading with reading, etc.)
                        if (otherStatus === draggedStatus) {
                            otherBook.classList.add("shake-animation");
                        } else {
                            // Mark incompatible books
                            otherBook.classList.add("drag-incompatible");
                        }
                    }
                });

                // Start auto-scroll monitoring
                if (typeof handleAutoScroll === "function") {
                    document.addEventListener("dragover", handleAutoScroll);
                }
            });

            // Drag end
            book.addEventListener("dragend", (e) => {
                book.classList.remove("dragging", "drag-prohibited");
                books.forEach(otherBook => {
                    otherBook.classList.remove("shake-animation", "drag-over", "drag-incompatible");
                });

                // Stop auto-scrolling and remove global listener
                if (typeof handleAutoScroll === "function") {
                    document.removeEventListener("dragover", handleAutoScroll);
                }

                draggedBook = null;
                draggedStatus = null;
            });

            // Drag over
            book.addEventListener("dragover", (e) => {
                if (draggedBook && draggedBook !== book) {
                    const dropStatus = book.dataset.bookStatus || "want";
                    // Only allow drop if statuses match
                    if (draggedStatus === dropStatus) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        book.classList.add("drag-over");
                        draggedBook.classList.remove("drag-prohibited");
                    } else {
                        e.dataTransfer.dropEffect = "none";
                        book.classList.remove("drag-over");
                        // Add vibrate animation to dragged book when over incompatible status
                        draggedBook.classList.add("drag-prohibited");
                    }
                }
            });

            // Drag leave
            book.addEventListener("dragleave", (e) => {
                book.classList.remove("drag-over");
                // Remove prohibited animation when leaving incompatible book
                if (draggedBook) {
                    const dropStatus = book.dataset.bookStatus || "want";
                    if (draggedStatus !== dropStatus) {
                        draggedBook.classList.remove("drag-prohibited");
                    }
                }
            });

            // Drop
            book.addEventListener("drop", async (e) => {
                e.preventDefault();
                book.classList.remove("drag-over");

                if (draggedBook && draggedBook !== book) {
                    const dropStatus = book.dataset.bookStatus || "want";
                    // Prevent swap if statuses don't match
                    if (draggedStatus !== dropStatus) {
                        return;
                    }

                    const dropIndex = parseInt(book.dataset.bookIndex);

                    // Swap positions in DOM - simple and reliable method
                    const container = book.parentElement;
                    const draggedElement = draggedBook;
                    const dropElement = book;

                    // Store next siblings BEFORE any DOM manipulation
                    const draggedNext = draggedElement.nextSibling;
                    const dropNext = dropElement.nextSibling;

                    if (draggedIndex < dropIndex) {
                        // Case: [dragged] ... [drop]
                        // Step 1: Move drop to where dragged is (before dragged)
                        container.insertBefore(dropElement, draggedElement);
                        // Step 2: Move dragged to where drop was (after dropNext)
                        // Note: dropNext is still valid because it was captured before any moves
                        if (dropNext) {
                            container.insertBefore(draggedElement, dropNext);
                        } else {
                            container.appendChild(draggedElement);
                        }
                    } else {
                        // Case: [drop] ... [dragged]  
                        // Step 1: Move dragged to where drop is (before drop)
                        container.insertBefore(draggedElement, dropElement);
                        // Step 2: Move drop to where dragged was (after draggedNext)
                        // Note: draggedNext is still valid because it was captured before any moves
                        if (draggedNext) {
                            container.insertBefore(dropElement, draggedNext);
                        } else {
                            container.appendChild(dropElement);
                        }
                    }

                    // Update book order in storage
                    const allBooks = reader.util.loadAllElems(".draggable-book");
                    const newOrder = Array.from(allBooks).map(b => b.dataset.bookTitle);
                    const draggedNewIndex = Array.from(allBooks).indexOf(draggedElement);
                    await reader.store.saveBookOrder(newOrder);

                    // Update data-book-index attributes and podium labels
                    allBooks.forEach((b, idx) => {
                        b.dataset.bookIndex = idx;
                        // Update podium labels
                        const existingLabel = b.querySelector(".podiumLabel");
                        if (idx < 3) {
                            if (!existingLabel) {
                                const label = document.createElement("div");
                                label.className = `podiumLabel podium-${idx + 1}`;
                                label.textContent = idx === 0 ? '1st' : idx === 1 ? '2nd' : '3rd';
                                b.insertBefore(label, b.firstChild);

                                // Setup hover for new label
                                let bookHoverTimeout = null;
                                b.addEventListener("mouseenter", () => {
                                    if (bookHoverTimeout) {
                                        clearTimeout(bookHoverTimeout);
                                        bookHoverTimeout = null;
                                    }
                                    label.classList.add("podium-visible");
                                });
                                b.addEventListener("mouseleave", () => {
                                    bookHoverTimeout = setTimeout(() => {
                                        label.classList.remove("podium-visible");
                                        bookHoverTimeout = null;
                                    }, 5000);
                                });
                            } else {
                                existingLabel.className = `podiumLabel podium-${idx + 1}`;
                                existingLabel.textContent = idx === 0 ? '1st' : idx === 1 ? '2nd' : '3rd';
                            }
                        } else if (existingLabel) {
                            existingLabel.remove();
                        }
                        ensurePodiumCrown(b, idx);
                    });

                    const promotions = [
                        { oldIndex: draggedIndex, newIndex: dropIndex },
                        { oldIndex: dropIndex, newIndex: draggedIndex }
                    ];
                    let podiumSoundRank = 0;
                    for (const promo of promotions) {
                        if (promo.newIndex === 0 && promo.oldIndex > 0) {
                            podiumSoundRank = 1;
                            break;
                        }
                        if (promo.newIndex === 1 && promo.oldIndex > 1) {
                            podiumSoundRank = Math.max(podiumSoundRank, 2);
                        }
                        if (promo.newIndex === 2 && promo.oldIndex > 2) {
                            podiumSoundRank = Math.max(podiumSoundRank, 3);
                        }
                    }
                    if (podiumSoundRank) {
                        interfaceRef.playPodiumSound(podiumSoundRank);
                    }
                    if (draggedNewIndex === allBooks.length - 1 && draggedNewIndex !== -1) {
                        interfaceRef.playLastPlaceSound();
                    }

                    const isDisadvantagedSwap = draggedIndex > dropIndex;
                    let rollDelay = 0;
                    if (isDisadvantagedSwap) {
                        const existingBoot = dropElement.querySelector(".boot-kick-overlay");
                        if (existingBoot) existingBoot.remove();
                        const existingAss = dropElement.querySelector(".ass-kick-overlay");
                        if (existingAss) existingAss.remove();
                        const existingClash = dropElement.querySelector(".clash-kick-overlay");
                        if (existingClash) existingClash.remove();

                        const coverTone = await getCoverTone(dropElement);
                        const boot = document.createElement("img");
                        boot.className = "boot-kick-overlay";
                        if (coverTone === "white") boot.classList.add("boot-kick-white");
                        boot.src = "assets/boot.png";
                        boot.setAttribute("alt", "");
                        dropElement.appendChild(boot);

                        const ass = document.createElement("img");
                        ass.className = "ass-kick-overlay";
                        if (coverTone === "white") ass.classList.add("ass-kick-white");
                        ass.src = "assets/ass.png";
                        ass.setAttribute("alt", "");
                        dropElement.appendChild(ass);

                        const clash = document.createElement("img");
                        clash.className = "clash-kick-overlay";
                        if (coverTone === "white") clash.classList.add("clash-kick-yellow");
                        clash.src = "assets/clash.png";
                        clash.setAttribute("alt", "");
                        dropElement.appendChild(clash);

                        const bootDuration = 3500;
                        setTimeout(() => {
                            if (boot.parentElement) boot.remove();
                            if (ass.parentElement) ass.remove();
                            if (clash.parentElement) clash.remove();
                        }, bootDuration + 150);
                        rollDelay = bootDuration;
                    }

                    setTimeout(() => {
                        dropElement.classList.add("rolling-animation");
                        setTimeout(() => {
                            dropElement.classList.remove("rolling-animation");
                        }, 1800);
                    }, rollDelay);

                    // Show smiley mouths on 8 other books after the swap animation finishes
                    setTimeout(() => {
                        showSmileyMouths([draggedElement, dropElement]);
                    }, rollDelay + 1900);
                }
            });

            // Podium label hover functionality
            const podiumLabel = book.querySelector(".podiumLabel");
            if (podiumLabel) {
                let bookHoverTimeout = null;

                book.addEventListener("mouseenter", () => {
                    if (bookHoverTimeout) {
                        clearTimeout(bookHoverTimeout);
                        bookHoverTimeout = null;
                    }
                    podiumLabel.classList.add("podium-visible");
                });

                book.addEventListener("mouseleave", () => {
                    bookHoverTimeout = setTimeout(() => {
                        podiumLabel.classList.remove("podium-visible");
                        bookHoverTimeout = null;
                    }, 5000); // Hide after 5 seconds
                });
            }
        });
    }
}







