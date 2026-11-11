const readerUrl = chrome.runtime.getURL("index.html");

chrome.tabs.create({ url: readerUrl }, () => {
	window.close();
});
