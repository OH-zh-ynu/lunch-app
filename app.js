document.addEventListener('DOMContentLoaded', () => {
    // ─── API CONFIGURATION ───
    const API_KEY = 'f15b7ad9efab6381';

    // ─── Shared dual-proxy fetch helper ───
    async function fetchViaProxy(targetUrl) {
        const proxies = [
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
        ];
        for (const proxyUrl of proxies) {
            try {
                const response = await fetch(proxyUrl);
                if (!response.ok) continue;
                const text = await response.text();
                if (text.length > 10) return text;
            } catch (e) {
                continue;
            }
        }
        throw new Error('All proxies failed for: ' + targetUrl);
    }

    // ─── DOM ELEMENTS ───
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    // Search elements
    const locationInput = document.getElementById('location-input');
    const areaSelectBtn = document.getElementById('area-select-btn');
    const keywordInput = document.getElementById('keyword-input');
    const lunchBudgetSelect = document.getElementById('lunch-budget-select');
    const genreSelect = document.getElementById('genre-select');
    const advancedToggleBtn = document.getElementById('advanced-toggle-btn');
    const advancedFilters = document.getElementById('advanced-filters');
    const searchBtn = document.getElementById('search-btn');

    // ─── Concurrent scraping queue for lunch budgets ───
    const MAX_CONCURRENT_SCRAPES = 3;
    let activeScrapes = 0;
    const scrapeQueue = [];
    const budgetCache = {}; // shopId -> budget string or null

    function enqueueScrape(el) {
        scrapeQueue.push(el);
        processScrapeQueue();
    }

    function processScrapeQueue() {
        while (activeScrapes < MAX_CONCURRENT_SCRAPES && scrapeQueue.length > 0) {
            const el = scrapeQueue.shift();
            activeScrapes++;
            fetchLunchBudgetRow(el).finally(() => {
                activeScrapes--;
                processScrapeQueue();
            });
        }
    }

    // Intersection Observer for lazy loading scraped lunch budget
    const budgetObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                observer.unobserve(el);
                const shopId = el.dataset.shopId;
                // Check cache first
                if (shopId in budgetCache) {
                    if (budgetCache[shopId]) {
                        el.querySelector('.budget-value').textContent = `ランチ予算: ${budgetCache[shopId]}`;
                        el.style.display = 'flex';
                    } else {
                        el.style.display = 'none';
                    }
                } else {
                    enqueueScrape(el);
                }
            }
        });
    }, { rootMargin: '200px' });

    async function fetchLunchBudgetRow(el) {
        const shopId = el.dataset.shopId;
        el.style.display = 'flex'; // Show loading state
        try {
            const targetUrl = `https://www.hotpepper.jp/str${shopId}/`;
            let html = '';

            // Try multiple proxies for reliability
            const proxies = [
                `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
                `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`
            ];

            for (const proxyUrl of proxies) {
                try {
                    const response = await fetch(proxyUrl);
                    if (!response.ok) continue;
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const data = await response.json();
                        html = data.contents || '';
                    } else {
                        html = await response.text();
                    }
                    if (html.length > 100) break; // Got meaningful content
                } catch (proxyErr) {
                    continue;
                }
            }

            if (!html) throw new Error('All proxies failed');

            // Extract budget string using regex
            const match = html.match(/shopInfoBudgetLunch[^>]*>([^<]+)</)
                || html.match(/BudgetLunch[^>]*>([^<]+)</);
            if (match && match[1] && match[1].trim()) {
                const budgetStr = match[1].trim();
                budgetCache[shopId] = budgetStr;
                el.querySelector('.budget-value').textContent = `ランチ予算: ${budgetStr}`;
            } else {
                budgetCache[shopId] = null;
                el.style.display = 'none';
            }
        } catch (e) {
            budgetCache[shopId] = null;
            el.style.display = 'none';
        }
    }

    // Area Modal elements
    const areaModal = document.getElementById('area-modal');
    const closeAreaModalBtn = document.getElementById('close-area-modal-btn');
    const areaModalTitle = document.getElementById('area-modal-title');
    const areaModalBody = document.getElementById('area-modal-body');
    const areaGrid = document.getElementById('area-grid');
    const areaLoading = document.getElementById('area-loading');
    const areaModalFooter = document.getElementById('area-modal-footer');
    const areaBackBtn = document.getElementById('area-back-btn');

    // Results elements
    const resultsHeader = document.getElementById('results-header');
    const resultCount = document.getElementById('result-count');
    const loadingIndicator = document.getElementById('loading-indicator');
    const resultsGrid = document.getElementById('results-grid');
    const emptySearchState = document.getElementById('empty-search-state');

    // Stock elements
    const stockCountBadge = document.getElementById('stock-count');
    const stockGrid = document.getElementById('stock-grid');
    const emptyStockState = document.getElementById('empty-stock-state');
    const goSearchBtn = document.querySelector('.go-search-btn');

    // Toast
    const toastContainer = document.getElementById('toast-container');

    // ─── STATE ───
    let currentResults = [];
    let stockedRestaurants = JSON.parse(localStorage.getItem('lunch_app_stocks')) || {};

    // Area Master State
    let largeAreas = []; // array of { code, name }
    let middleAreasByLarge = {}; // code -> array of { code, name }
    let currentLargeAreaSelection = null;
    let cachedAreaDictionary = {}; // Map text (like '新宿') to middle area code ('Y055')

    // ─── INITIALIZATION ───
    updateStockCount();
    renderStocked();
    prefetchMajorAreas(); // Fetch major areas in the background

    // ─── TAB SWITCHING ───
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    goSearchBtn.addEventListener('click', () => switchTab('search'));

    function switchTab(tabId) {
        navBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(tc => tc.classList.remove('active'));

        document.querySelector(`.nav-btn[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(`tab-${tabId}`).classList.add('active');

        if (tabId === 'stock') {
            renderStocked();
        }
    }

    // ─── AREA SELECTION LOGIC ───
    // Background fetch for mapping inputs to area codes
    async function prefetchMajorAreas() {
        try {
            const apiUrl = `https://webservice.recruit.co.jp/hotpepper/large_area/v1/?key=${API_KEY}&format=json`;
            const text = await fetchViaProxy(apiUrl);
            const data = JSON.parse(text);
            if (data.results && data.results.large_area) {
                largeAreas = data.results.large_area;
            }
        } catch (e) {
            console.error('Initial Large Area fetch failed', e);
        }
    }

    async function fetchMiddleAreas(largeAreaCode) {
        if (middleAreasByLarge[largeAreaCode]) return middleAreasByLarge[largeAreaCode];

        try {
            const apiUrl = `https://webservice.recruit.co.jp/hotpepper/middle_area/v1/?key=${API_KEY}&large_area=${largeAreaCode}&count=100&format=json`;
            const text = await fetchViaProxy(apiUrl);
            const data = JSON.parse(text);
            if (data.results && data.results.middle_area) {
                middleAreasByLarge[largeAreaCode] = data.results.middle_area;
                // Add to dictionary for instant search mapping
                data.results.middle_area.forEach(ma => {
                    cachedAreaDictionary[ma.name] = ma.code;
                });
                return data.results.middle_area;
            }
        } catch (e) {
            console.error('Middle Area fetch failed', e);
        }
        return [];
    }

    // Modal Interaction
    areaSelectBtn.addEventListener('click', () => {
        areaModal.classList.remove('hidden');
        renderLargeAreas();
    });

    closeAreaModalBtn.addEventListener('click', () => {
        areaModal.classList.add('hidden');
    });

    areaBackBtn.addEventListener('click', () => {
        renderLargeAreas();
    });

    function renderLargeAreas() {
        currentLargeAreaSelection = null;
        areaModalTitle.innerHTML = '<i class="ph ph-map-trifold"></i> 都道府県を選択';
        areaModalFooter.classList.add('hidden');
        areaGrid.innerHTML = '';

        if (largeAreas.length === 0) {
            // Need to fetch logic if it failed on init
            areaLoading.classList.remove('hidden');
            prefetchMajorAreas().then(() => {
                areaLoading.classList.add('hidden');
                populateLargeAreas();
            });
        } else {
            populateLargeAreas();
        }
    }

    function populateLargeAreas() {
        largeAreas.forEach(area => {
            const btn = document.createElement('button');
            btn.className = 'area-btn';
            btn.textContent = area.name;
            btn.addEventListener('click', () => {
                currentLargeAreaSelection = { code: area.code, name: area.name };
                renderMiddleAreas(area.code, area.name);
            });
            areaGrid.appendChild(btn);
        });
    }

    function renderMiddleAreas(largeAreaCode, largeAreaName) {
        areaModalTitle.innerHTML = `<i class="ph ph-map-pin"></i> ${largeAreaName} のエリアを選択`;
        areaModalFooter.classList.remove('hidden');
        areaGrid.innerHTML = '';
        areaLoading.classList.remove('hidden');

        fetchMiddleAreas(largeAreaCode).then(areas => {
            areaLoading.classList.add('hidden');
            if (areas.length === 0) {
                const btn = document.createElement('button');
                btn.className = 'area-btn';
                btn.textContent = `${largeAreaName}全域`;
                btn.addEventListener('click', () => selectAreaVal(largeAreaName, largeAreaCode, 'large'));
                areaGrid.appendChild(btn);
            } else {
                areas.forEach(area => {
                    const btn = document.createElement('button');
                    btn.className = 'area-btn';
                    btn.textContent = area.name;
                    btn.addEventListener('click', () => selectAreaVal(area.name, area.code, 'middle'));
                    areaGrid.appendChild(btn);
                });
            }
        });
    }

    function selectAreaVal(areaName, code, type) {
        locationInput.value = areaName;
        locationInput.dataset.areaCode = code;
        locationInput.dataset.areaType = type;
        areaModal.classList.add('hidden');
    }

    // Clear saved area code if user manually edits the input
    locationInput.addEventListener('input', () => {
        delete locationInput.dataset.areaCode;
        delete locationInput.dataset.areaType;
    });

    // ─── ADVANCED FILTERS TOGGLE ───
    advancedToggleBtn.addEventListener('click', () => {
        advancedFilters.classList.toggle('hidden');
        advancedToggleBtn.classList.toggle('open');
    });

    // ─── SEARCH LOGIC ───
    const genreDictionary = {
        '居酒屋': 'G001',
        'ダイニングバー': 'G002', 'バル': 'G002', 'ダイニングバー・バル': 'G002',
        '創作料理': 'G003',
        '和食': 'G004', '日本料理': 'G004', '寿司': 'G004', 'うどん': 'G004', 'そば': 'G004',
        '洋食': 'G005', 'ステーキ': 'G005', 'ハンバーグ': 'G005',
        'イタリアン': 'G006', 'フレンチ': 'G006', 'パスタ': 'G006', 'ピザ': 'G006', 'イタリアン・フレンチ': 'G006',
        '中華': 'G007',
        '焼肉': 'G008', 'ホルモン': 'G008', '焼肉・ホルモン': 'G008',
        '韓国料理': 'G017',
        'アジア料理': 'G009', 'エスニック料理': 'G009', 'タイ料理': 'G009', 'ベトナム料理': 'G009', 'インド料理': 'G009', 'アジア・エスニック料理': 'G009',
        '各国料理': 'G010', 'スペイン料理': 'G010',
        'カラオケ': 'G011', 'パーティ': 'G011', 'カラオケ・パーティ': 'G011',
        'バー': 'G012', 'カクテル': 'G012', 'バー・カクテル': 'G012',
        'ラーメン': 'G013',
        'お好み焼き': 'G016', 'もんじゃ': 'G016', 'お好み焼き・もんじゃ': 'G016',
        'カフェ': 'G014', 'スイーツ': 'G014', 'カフェ・スイーツ': 'G014',
        'その他グルメ': 'G015'
    };

    searchBtn.addEventListener('click', performSearch);
    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    async function performSearch() {
        const locationKeyword = locationInput.value.trim();
        const conditionKeyword = keywordInput.value.trim();
        const targetBudget = parseInt(lunchBudgetSelect.value, 10); // user chosen max limit

        // Location or Condition must be provided
        if (!locationKeyword && !conditionKeyword) {
            showToast('場所または条件を入力してください', 'error');
            return;
        }

        // Advanced logic: map text to area code if typed exactly
        let areaQueryParam = '';
        if (locationKeyword) {
            if (locationInput.dataset.areaCode) {
                // User picked from the modal
                const code = locationInput.dataset.areaCode;
                const type = locationInput.dataset.areaType;
                areaQueryParam = type === 'middle' ? `&middle_area=${code}` : `&large_area=${code}`;
            } else if (cachedAreaDictionary[locationKeyword]) {
                // User typed something we have in our cached dictionary (like '新宿')
                areaQueryParam = `&middle_area=${cachedAreaDictionary[locationKeyword]}`;
            } else {
                // Fallback: check large areas
                const large = largeAreas.find(la => la.name === locationKeyword);
                if (large) {
                    areaQueryParam = `&large_area=${large.code}`;
                }
            }
        }

        // Advanced logic: map condition text to genre code
        let genreQueryParam = '';
        let finalConditionKeyword = conditionKeyword;
        if (conditionKeyword) {
            // First check exact match
            if (genreDictionary[conditionKeyword]) {
                genreQueryParam = `&genre=${genreDictionary[conditionKeyword]}`;
                finalConditionKeyword = '';
            } else {
                // Check partial match so that "新宿 焼肉" or just "焼肉 個室" can extract "焼肉" as genre
                for (const [key, val] of Object.entries(genreDictionary)) {
                    if (conditionKeyword.includes(key)) {
                        genreQueryParam = `&genre=${val}`;
                        finalConditionKeyword = conditionKeyword.replace(key, '').trim();
                        break;
                    }
                }
            }
        }

        // Space-separated keywords for HotPepper API. Only use locationKeyword as keyword if it wasn't matched as an area.
        const mergedKeywordStrings = [];
        if (locationKeyword && !areaQueryParam) mergedKeywordStrings.push(locationKeyword);
        if (finalConditionKeyword) mergedKeywordStrings.push(finalConditionKeyword);
        const finalKeywordParam = mergedKeywordStrings.length > 0 ? `&keyword=${encodeURIComponent(mergedKeywordStrings.join(' '))}` : '';

        // Build advanced filter params
        let advancedParams = '';
        const genreCode = genreSelect.value;
        if (genreCode && !genreQueryParam) { // Don't override if user typed a genre
            advancedParams += `&genre=${genreCode}`;
        }
        if (genreQueryParam) advancedParams += genreQueryParam;

        const filterMap = {
            'filter-private-room': 'private_room',
            'filter-wifi': 'wifi',
            'filter-free-drink': 'free_drink',
            'filter-free-food': 'free_food',
            'filter-parking': 'parking',
            'filter-card': 'card',
            'filter-non-smoking': 'non_smoking',
            'filter-pet': 'pet'
        };

        for (const [elemId, paramName] of Object.entries(filterMap)) {
            const cb = document.getElementById(elemId);
            if (cb && cb.checked) {
                advancedParams += `&${paramName}=1`;
            }
        }

        // UI Reset
        emptySearchState.classList.add('hidden');
        resultsHeader.classList.add('hidden');
        resultsGrid.innerHTML = '';
        loadingIndicator.classList.remove('hidden');
        searchBtn.disabled = true;

        try {
            const count = 100;
            const baseUrl = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${API_KEY}&format=json${areaQueryParam}${finalKeywordParam}${advancedParams}&lunch=1&count=${count}`;

            // Use dual-proxy helper for reliability
            const text = await fetchViaProxy(baseUrl);
            const data = JSON.parse(text);

            // ─── HotPepper API Error Handling (HTTP 200 but error in body) ───
            if (data.results && data.results.error) {
                const apiError = data.results.error[0] || data.results.error;
                const errorCode = apiError.code || '';
                const errorMessage = apiError.message || '';
                console.error('HotPepper API Error:', errorCode, errorMessage);

                if (String(errorCode) === '1000') {
                    showToast('ホットペッパーサーバーに障害が発生しています。しばらく待ってから再試行してください。', 'error');
                } else if (String(errorCode) === '2000') {
                    showToast('APIキーまたはIPアドレスの認証に失敗しました。設定を確認してください。', 'error');
                } else if (String(errorCode) === '3000') {
                    showToast(`検索パラメータに誤りがあります: ${errorMessage}`, 'error');
                } else {
                    showToast(`APIエラーが発生しました (${errorCode}): ${errorMessage}`, 'error');
                }
                loadingIndicator.classList.add('hidden');
                searchBtn.disabled = false;
                emptySearchState.classList.remove('hidden');
                return; // Stop further processing
            }

            if (data.results && data.results.shop) {
                let shops = data.results.shop;

                // ─── CLIENT-SIDE BUDGET FILTERING ───
                if (!isNaN(targetBudget)) {
                    shops = shops.filter(shop => {
                        let priceToCheck = null;

                        // 1. Check explicitly listed lunch price first (e.g. "ランチ：1200円")
                        const lunchText = shop.lunch || "";
                        const lunchNumbers = lunchText.match(/\d+(?:,\d+)?/g);
                        if (lunchNumbers) {
                            priceToCheck = parseInt(lunchNumbers[0].replace(/,/g, ''), 10);
                        } else {
                            // 2. If lunch text has no price, fall back to the overall budget string
                            // This ensures that if the UI shows "予算目安: 3001～4000円", it gets filtered out correctly
                            const budgetText = (shop.budget?.average || shop.budget?.name || "").toString();
                            const budgetNumbers = budgetText.match(/\d+(?:,\d+)?/g);
                            if (budgetNumbers) {
                                // Extract the first number as the min budget
                                priceToCheck = parseInt(budgetNumbers[0].replace(/,/g, ''), 10);
                            }
                        }

                        // Apply filter if we found a valid price
                        if (priceToCheck !== null) {
                            if (targetBudget === 5000) {
                                // "プチ贅沢 (3,000円以上)" target
                                return priceToCheck >= 3000;
                            }
                            return priceToCheck <= targetBudget;
                        }

                        // If no price could be determined, fallback to keeping it
                        return true;
                    });
                }

                currentResults = shops;
                renderResults(shops);
            } else if (data.results && data.results.results_available === '0') {
                // No results, but not an error
                currentResults = [];
                renderResults([]);
            } else {
                throw new Error('INVALID_RESPONSE');
            }

        } catch (error) {
            console.error('Search error:', error);
            let msg = '検索中にエラーが発生しました。';

            if (error.message.includes('All proxies failed')) {
                msg = 'API通信がブロックされました。BraveブラウザのShieldや、uBlock Origin等の広告プロッカーをオフにして再試行してください。';
            } else if (error.message === 'NETWORK_ERROR' || (error.name === 'TypeError' && error.message.includes('Failed to fetch'))) {
                msg = 'ネットワーク接続に失敗しました、またはAdBlockerにより通信が遮断されています。設定を確認してください。';
            } else if (error.message === 'INVALID_RESPONSE') {
                msg = 'APIから予期しないレスポンスが返されました。条件を変えて再試行してください。';
            } else if (error.name === 'SyntaxError') {
                msg = '中継サーバーから不正なレスポンスを受信しました。しばらく待ってから再試行してください。';
            }
            showToast(msg, 'error');
            loadingIndicator.classList.add('hidden');
            searchBtn.disabled = false;
            emptySearchState.classList.remove('hidden');
        }
    }

    // ─── RENDERING ───
    function renderResults(shops) {
        loadingIndicator.classList.add('hidden');
        searchBtn.disabled = false;

        if (shops.length === 0) {
            emptySearchState.querySelector('p').textContent = '条件に合うランチ営業のお店が見つかりませんでした。';
            emptySearchState.classList.remove('hidden');
            return;
        }

        resultCount.textContent = shops.length;
        resultsHeader.classList.remove('hidden');

        shops.forEach(shop => {
            const card = createRestaurantCard(shop, false);
            resultsGrid.appendChild(card);

            // Observe the placeholder for lunch budget scraping if it exists
            const scarpedEl = card.querySelector('.scraped-lunch-budget');
            if (scarpedEl) budgetObserver.observe(scarpedEl);
        });
    }

    function renderStocked() {
        stockGrid.innerHTML = '';
        const stocks = Object.values(stockedRestaurants);

        if (stocks.length === 0) {
            emptyStockState.classList.remove('hidden');
            stockGrid.style.display = 'none';
        } else {
            emptyStockState.classList.add('hidden');
            stockGrid.style.display = 'grid';

            stocks.reverse().forEach(shop => {
                const card = createRestaurantCard(shop, true);
                stockGrid.appendChild(card);
            });
        }
    }

    function createRestaurantCard(shop, isStockView) {
        const card = document.createElement('div');
        card.className = 'rest-card';
        card.dataset.id = shop.id;

        const isStocked = !!stockedRestaurants[shop.id];

        const photoUrl = shop.photo?.pc?.l || shop.photo?.pc?.m || 'https://placehold.co/400x300?text=No+Image';
        const url = shop.urls?.pc || '#';
        const genre = shop.genre?.name || 'ジャンル不明';

        // Parse lunch budget if available
        const lunchText = shop.lunch || '情報なし';
        let lunchBudgetHtml = '';
        const lunchNumbers = lunchText.match(/\d+(?:,\d+)?/g);
        if (lunchNumbers) {
            lunchBudgetHtml = `
                    <div class="info-row">
                        <i class="ph ph-wallet"></i>
                        <span style="font-weight: 500;">ランチ予算目安: ${lunchNumbers[0]}円〜</span>
                    </div>`;
        } else {
            // Setup placeholder for scraping if no upfront price is found
            lunchBudgetHtml = `
                    <div class="info-row scraped-lunch-budget" data-shop-id="${shop.id}" style="display: flex;">
                        <i class="ph ph-wallet"></i>
                        <span class="budget-value" style="font-weight: 500; color: var(--text-muted); font-size: 0.8rem;">ランチ予算取得中...</span>
                    </div>`;
        }

        // Build lunch menu URL from shop.id directly (API URLs have ?vos=... params that break /lunch/ suffix)
        const lunchMenuUrl = `https://www.hotpepper.jp/str${shop.id}/lunch/`;

        card.innerHTML = `
            <div class="card-image-wrapper">
                <img src="${photoUrl}" alt="${shop.name}" class="card-image" loading="lazy">
                <button class="stock-btn ${isStocked ? 'active' : ''}" data-id="${shop.id}">
                    <i class="${isStocked ? 'ph-fill' : 'ph'} ph-bookmark-simple"></i>
                </button>
            </div>
            <div class="card-content">
                <span class="rest-genre">${genre}</span>
                <h3 class="rest-name"><a href="${url}" target="_blank">${shop.name}</a></h3>
                <p class="rest-catch">${shop.catch || ''}</p>
                
                <div class="rest-info">
                    <div class="info-row">
                        <i class="ph ph-map-pin"></i>
                        <span>${shop.mobile_access || shop.access || 'アクセス情報なし'}</span>
                    </div>
                    <div class="info-row lunch-highlight">
                        <i class="ph-fill ph-sun"></i>
                        <span>ランチ営業: ${lunchText}</span>
                    </div>
                    ${lunchBudgetHtml}
                    <div class="info-row">
                        <i class="ph ph-calendar-x"></i>
                        <span>休: ${shop.close || 'なし'}</span>
                    </div>
                    <div class="info-row">
                        <i class="ph ph-clock"></i>
                        <span style="font-size: 0.8rem; opacity: 0.8">${shop.open || ''}</span>
                    </div>
                </div>
                
                <div class="card-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <a href="${lunchMenuUrl}" target="_blank" class="lunch-menu-btn">
                        <i class="ph ph-book-open"></i> ランチメニュー・詳細
                    </a>
                </div>

                ${isStockView ? `
                <div class="memo-section">
                    <div class="memo-input-wrap">
                        <textarea class="memo-input" placeholder="メモを追加 (例: 平日限定ランチがおすすめ、12時は混む etc...)" data-id="${shop.id}">${shop.memo || ''}</textarea>
                        <button class="save-memo-btn" data-id="${shop.id}"><i class="ph ph-check"></i></button>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        // Stock Toggle Event
        const stockBtn = card.querySelector('.stock-btn');
        stockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStock(shop, stockBtn);
        });

        // Memo Event (Only in Stock View)
        if (isStockView) {
            const memoInput = card.querySelector('.memo-input');
            const saveMemoBtn = card.querySelector('.save-memo-btn');

            // Auto update memo on blur or button click
            const saveMemo = () => {
                if (stockedRestaurants[shop.id]) {
                    stockedRestaurants[shop.id].memo = memoInput.value;
                    saveStocksToStorage();
                    showToast('メモを保存しました', 'success');
                }
            };

            saveMemoBtn.addEventListener('click', saveMemo);
            memoInput.addEventListener('blur', saveMemo);
        }

        return card;
    }

    // ─── STOCK MANAGEMENT ───
    function toggleStock(shop, btnEl) {
        if (stockedRestaurants[shop.id]) {
            // Remove
            delete stockedRestaurants[shop.id];
            btnEl.classList.remove('active');
            btnEl.querySelector('i').classList.replace('ph-fill', 'ph');
            showToast('ストックから削除しました', 'info');

            // If in stock view, remove card visually
            if (document.getElementById('tab-stock').classList.contains('active')) {
                const card = document.querySelector(`.rest-card[data-id="${shop.id}"]`);
                if (card) {
                    card.style.opacity = '0';
                    setTimeout(() => renderStocked(), 300);
                }
            }
        } else {
            // Add (deep copy needed info)
            stockedRestaurants[shop.id] = {
                id: shop.id,
                name: shop.name,
                catch: shop.catch,
                genre: { name: shop.genre?.name },
                photo: { pc: { l: shop.photo?.pc?.l, m: shop.photo?.pc?.m } },
                urls: { pc: shop.urls?.pc },
                access: shop.access,
                mobile_access: shop.mobile_access,
                lunch: shop.lunch,
                budget: shop.budget,
                close: shop.close,
                open: shop.open,
                memo: '' // initialize memo
            };
            btnEl.classList.add('active');
            btnEl.querySelector('i').classList.replace('ph', 'ph-fill');
            showToast('お店をストックしました！', 'success');
        }

        saveStocksToStorage();
    }

    function saveStocksToStorage() {
        localStorage.setItem('lunch_app_stocks', JSON.stringify(stockedRestaurants));
        updateStockCount();
    }

    function updateStockCount() {
        const count = Object.keys(stockedRestaurants).length;
        stockCountBadge.textContent = count;

        if (count > 0) {
            stockCountBadge.style.transform = 'scale(1.2)';
            setTimeout(() => stockCountBadge.style.transform = 'scale(1)', 200);
        }
    }

    // ─── UTILS (Toast) ───
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let iconHtml = '';
        if (type === 'success') iconHtml = '<i class="ph-fill ph-check-circle toast-icon"></i>';
        else if (type === 'error') iconHtml = '<i class="ph-fill ph-x-circle toast-icon"></i>';
        else iconHtml = '<i class="ph-fill ph-info toast-icon"></i>';

        toast.innerHTML = `${iconHtml}<span>${message}</span>`;
        toastContainer.appendChild(toast);

        // Trigger reflow for animation
        toast.offsetHeight;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400); // Wait for transition
        }, 3000);
    }
});
