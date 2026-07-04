// ==UserScript==
// @name         스토브 100뽑기 API 자동화
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  수동 중단 시에도 보상 수령 완벽 지원, 다중 계정 및 플레이크 수익 계산 패널 탑재
// @icon         https://reward.onstove.com/favicon.ico
// @match        *://reward.onstove.com/*
// @updateURL    https://raw.githubusercontent.com/TellurideX/New-Stove-Flake-Automation-Script-Tampermonkey/main/main.user.js
// @downloadURL  https://raw.githubusercontent.com/TellurideX/New-Stove-Flake-Automation-Script-Tampermonkey/main/main.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let SAVED_TOKEN = "";
    let CALLER_ID = "flake-fe";
    let CALLER_DETAIL = "abb02500-599b-4a35-918c-989fc3ff0647"; 
    
    let ABSOLUTE_DRAW_CNT = null; 
    let CURRENT_LOGS = []; 
    let TRACKED_SPENT = 0; 
    let TRACKED_EARNED = 0; 
    
    const MAX_DRAW = 30;
    const DELAY_MS = 500; 
    let isRunning = false; 

    console.log("🔴 스토브 자동화 정식 V1.0 로드 완료. 사용자 통제 모드 활성화...");

    // ==========================================
    // 0. 장부 관리 및 고유 ID 해독 시스템
    // ==========================================
    function getTodayDate() {
        return new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    }

    function getAccountId(token) {
        if (!token) return 'unknown';
        try {
            const base64Url = token.split('.')[1];
            if (!base64Url) return token.slice(-20); 
            
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const parsed = JSON.parse(jsonPayload);
            
            if (parsed.member_no) return String(parsed.member_no);
            if (parsed.sub) return String(parsed.sub);
            if (parsed.user_id) return String(parsed.user_id);
            return token.slice(-20); 
        } catch(e) {
            return token.slice(-20);
        }
    }

    function updateLedger(token, updates) {
        if (!token) return null;
        try {
            let data = JSON.parse(localStorage.getItem('stove_macro_ledger') || '{}');
            if (data.date !== getTodayDate()) data = { date: getTodayDate(), accounts: {} };
            
            const accountId = getAccountId(token); 
            const accData = data.accounts[accountId];
            
            if (accData === undefined || typeof accData === 'number') {
                const oldCount = typeof accData === 'number' ? accData : 0;
                data.accounts[accountId] = { count: oldCount, logs: [], spent: 0, earned: 0 };
            } else if (accData.spent === undefined) {
                data.accounts[accountId].spent = 0;
                data.accounts[accountId].earned = 0;
            }
            
            if (updates.count !== undefined) data.accounts[accountId].count = updates.count;
            if (updates.newLog !== undefined) data.accounts[accountId].logs.push(updates.newLog);
            if (updates.earnedFlakes !== undefined) {
                data.accounts[accountId].spent += 100;
                data.accounts[accountId].earned += updates.earnedFlakes;
            }
            localStorage.setItem('stove_macro_ledger', JSON.stringify(data));
            return data.accounts[accountId];
        } catch(e) { return null; }
    }

    function loadDataFromLocal(token) {
        if (!token) return null;
        try {
            let data = JSON.parse(localStorage.getItem('stove_macro_ledger') || '{}');
            const accountId = getAccountId(token); 
            if (data.date === getTodayDate() && data.accounts && data.accounts[accountId] !== undefined) {
                const accData = data.accounts[accountId];
                if (typeof accData === 'number') return { count: accData, logs: [], spent: 0, earned: 0 };
                if (accData.spent === undefined) {
                    accData.spent = 0;
                    accData.earned = 0;
                }
                return accData;
            }
        } catch(e) {}
        return null; 
    }

    // ==========================================
    // 1. UI 상태 및 로그/수익 박스 업데이트
    // ==========================================
    function updateCountUI() {
        const countText = document.getElementById("draw-count-text");
        const targetBtn = document.getElementById("auto-draw-btn");
        
        if (countText && ABSOLUTE_DRAW_CNT !== null) {
            countText.innerText = `현재 계정 참여: ${ABSOLUTE_DRAW_CNT} / ${MAX_DRAW} 회`;
            
            if (ABSOLUTE_DRAW_CNT >= MAX_DRAW) {
                countText.style.color = "#f44336"; 
                if (targetBtn) {
                    targetBtn.innerHTML = "❌ 누적 보상 수령하기"; 
                    targetBtn.style.backgroundColor = "#2196F3"; 
                    targetBtn.dataset.status = "done";
                    isRunning = false; 
                }
            } else {
                countText.style.color = "#4CAF50"; 
                if (!isRunning && SAVED_TOKEN && targetBtn && targetBtn.dataset.status !== "done") {
                    targetBtn.innerHTML = "⚡ 자동 뽑기 시작";
                    targetBtn.style.backgroundColor = "#4CAF50"; 
                    targetBtn.dataset.status = "ready";
                }
            }
        }
    }

    function renderLogsAndSummary() {
        const logBox = document.getElementById("draw-log-box");
        if (logBox) {
            if (CURRENT_LOGS.length === 0) {
                logBox.innerHTML = `<div style="color:#666; text-align:center; padding-top:25px;">기록이 없습니다.</div>`;
            } else {
                logBox.innerHTML = CURRENT_LOGS.map(log => `<div style="margin-bottom:3px;">${log}</div>`).join('');
                logBox.scrollTop = logBox.scrollHeight; 
            }
        }

        const elSpent = document.getElementById("summary-spent");
        const elEarned = document.getElementById("summary-earned");
        const elProfit = document.getElementById("summary-profit");
        
        if (elSpent && elEarned && elProfit) {
            elSpent.innerText = `-${TRACKED_SPENT.toLocaleString()}`;
            elEarned.innerText = `+${TRACKED_EARNED.toLocaleString()}`;
            
            const profit = TRACKED_EARNED - TRACKED_SPENT;
            if (profit > 0) {
                elProfit.innerText = `+${profit.toLocaleString()}`;
                elProfit.style.color = "#4CAF50"; 
            } else if (profit < 0) {
                elProfit.innerText = `${profit.toLocaleString()}`;
                elProfit.style.color = "#f44336"; 
            } else {
                elProfit.innerText = `0`;
                elProfit.style.color = "#aaa"; 
            }
        }
    }

    // ==========================================
    // 1-5. 누적 보상 자동 수령 
    // ==========================================
    async function autoClaimCumulativeRewards() {
        const buttons = document.querySelectorAll("button.stds-button");
        let claimedCount = 0;

        for (const btn of buttons) {
            const text = btn.innerText || "";
            if (text.includes("받기") && !btn.disabled) {
                console.log(`🟢 [누적 보상 발견] 활성화된 버튼 클릭: ${text.trim()}`);
                btn.click(); 
                claimedCount++;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        if (claimedCount > 0) {
            alert(`🎉 총 ${claimedCount}개의 누적 보상을 자동으로 수령했습니다!`);
        } else {
            console.log("🟡 수령할 누적 보상이 없거나 이미 모두 수령했습니다.");
        }
    }

    // ==========================================
    // 2. Fetch 가로채기
    // ==========================================
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = args[0];
        const options = args[1];

        if (url && url.includes("api.onstove.com") && options && options.headers) {
            const headers = options.headers;
            let token = typeof headers.get === 'function' ? headers.get("Authorization") : headers["Authorization"];
            if (token && token.startsWith("Bearer ")) {
                if (SAVED_TOKEN !== token) {
                    SAVED_TOKEN = token;
                    const savedData = loadDataFromLocal(SAVED_TOKEN);
                    
                    if (savedData) {
                        ABSOLUTE_DRAW_CNT = savedData.count;
                        CURRENT_LOGS = savedData.logs || [];
                        TRACKED_SPENT = savedData.spent || 0;
                        TRACKED_EARNED = savedData.earned || 0;
                    } else {
                        ABSOLUTE_DRAW_CNT = null;
                        CURRENT_LOGS = [];
                        TRACKED_SPENT = 0;
                        TRACKED_EARNED = 0;
                    }
                    
                    if (ABSOLUTE_DRAW_CNT === null) {
                        const btn = document.getElementById("auto-draw-btn");
                        if(btn) {
                            btn.innerHTML = "⚡ 1회 실행 후 자동화 시작";
                            btn.style.backgroundColor = "#ff9800";
                            btn.dataset.status = "ready";
                        }
                    }
                    updateCountUI();
                    renderLogsAndSummary(); 
                }
            }
        }

        const response = await originalFetch.apply(this, args);

        if (url && url.includes("/draw/1000000374")) {
            try {
                const clonedResponse = response.clone(); 
                const data = await clonedResponse.json();
                
                if (response.ok && (data.code === 0 || data.message === 'OK')) {
                    if (data.value && data.value.user_draw_cnt !== undefined) {
                        ABSOLUTE_DRAW_CNT = data.value.user_draw_cnt;
                        
                        const giftInfo = data.value.gift_info || {};
                        const itemName = giftInfo.gift_name || "알 수 없는 아이템";
                        const earnedFlakes = (giftInfo.gift_type === 'flake') ? (giftInfo.gift_price || 0) : 0;
                        
                        const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
                        const logMsg = `<span style="color:#888;">[${timeStr}]</span> <span style="color:#4CAF50; font-weight:bold;">${itemName}</span>`;
                        
                        const updatedData = updateLedger(SAVED_TOKEN, { 
                            count: ABSOLUTE_DRAW_CNT, 
                            newLog: logMsg,
                            earnedFlakes: earnedFlakes
                        });
                        
                        if(updatedData) {
                            CURRENT_LOGS = updatedData.logs;
                            TRACKED_SPENT = updatedData.spent;
                            TRACKED_EARNED = updatedData.earned;
                            renderLogsAndSummary();
                        }
                        updateCountUI(); 
                    }
                } 
                else if (data.code === 7020 || (data.message && data.message.includes('exceeded'))) {
                    ABSOLUTE_DRAW_CNT = MAX_DRAW;
                    updateLedger(SAVED_TOKEN, { count: ABSOLUTE_DRAW_CNT });
                    updateCountUI();
                }
            } catch (e) {}
        }
        return response;
    };

    // ==========================================
    // 3. API 단일 호출
    // ==========================================
    async function executeDraw() {
        const url = "https://api.onstove.com/emsbackapi/v3.0/draw/1000000374";
        const payload = { type_no: 1 };

        try {
            await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": SAVED_TOKEN, 
                    "Caller-Id": CALLER_ID,
                    "Caller-Detail": CALLER_DETAIL,
                    "X-Lang": "ko",
                    "X-Nation": "KR"
                },
                body: JSON.stringify(payload),
                credentials: "include" 
            });
        } catch (error) {
            isRunning = false;
        }
    }

    // ==========================================
    // 4. UI 생성, 드래그 기능 및 루프 로직
    // ==========================================
    function createUI() {
        const container = document.createElement("div");
        container.style.position = "fixed";
        container.style.bottom = "20px";
        container.style.right = "20px";
        container.style.zIndex = "999999";
        container.style.padding = "15px";
        container.style.backgroundColor = "#222";
        container.style.color = "white";
        container.style.borderRadius = "8px";
        container.style.boxShadow = "0px 10px 20px rgba(0,0,0,0.5)";
        container.style.fontFamily = "sans-serif";
        container.style.width = "220px"; 
        container.style.cursor = "move"; 

        container.innerHTML = `
            <div style="font-weight:bold; margin-bottom:5px; font-size:14px; text-align:center; color:#ff9800; pointer-events:none;">🎰 100뽑기 자동화 V1.0</div>
            
            <div id="draw-count-text" style="text-align:center; margin-bottom:10px; font-size:13px; color:#aaa; font-weight:bold; pointer-events:none;">
                계정 연결 대기 중...
            </div>

            <button id="auto-draw-btn" data-status="waiting" style="width:100%; padding:10px; border:none; border-radius:4px; background-color:#555; color:white; font-weight:bold; cursor:pointer; line-height: 1.4; transition: 0.2s; margin-bottom: 10px;">
                🔄 토큰 대기 중...<br><span style="font-size:11px; font-weight:normal;">(화면의 원래 버튼 1회 클릭)</span>
            </button>
            
            <div id="draw-log-box" style="height: 85px; overflow-y: auto; background-color: #111; border-radius: 4px; padding: 8px; font-size: 11px; color: #ddd; border: 1px solid #333; margin-bottom: 5px; cursor: default;">
                <div style="color:#666; text-align:center; padding-top:25px;">기록이 없습니다.</div>
            </div>

            <div id="draw-summary-box" style="padding: 8px; background-color: #1a1a1a; border-radius: 4px; font-size: 11px; border: 1px solid #333; cursor: default;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span style="color: #aaa;">사용 (P):</span>
                    <span id="summary-spent" style="color: #f44336; font-weight: bold;">-0</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span style="color: #aaa;">획득 (P):</span>
                    <span id="summary-earned" style="color: #4CAF50; font-weight: bold;">+0</span>
                </div>
                <div style="border-top: 1px dashed #444; margin: 6px 0;"></div>
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 12px;">
                    <span style="color: #ddd;">실제 이득:</span>
                    <span id="summary-profit" style="color: #aaa;">0</span>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        container.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('#draw-log-box') || e.target.closest('#draw-summary-box')) {
                return;
            }
            isDragging = true;
            const rect = container.getBoundingClientRect();
            container.style.bottom = 'auto';
            container.style.right = 'auto';
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault(); 
            container.style.left = (e.clientX - offsetX) + 'px';
            container.style.top = (e.clientY - offsetY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) isDragging = false;
        });

        document.getElementById("auto-draw-btn").addEventListener("click", async function() {
            if (this.dataset.status === "done") {
                this.innerText = "수령 스캔 중...";
                this.style.backgroundColor = "#777";
                await autoClaimCumulativeRewards();
                setTimeout(() => {
                    this.innerHTML = "❌ 누적 보상 수령 완료";
                    this.style.backgroundColor = "#555";
                }, 1000);
                return;
            }

            if (this.dataset.status === "waiting") {
                alert("화면에 있는 원래 뽑기 버튼을 한 번 눌러서 계정을 연결해주세요!");
                return;
            }

            if (this.dataset.status === "running") {
                isRunning = false;
                this.innerHTML = "🛑 중지 및 새로고침 중...";
                this.style.backgroundColor = "#f44336"; 
                
                localStorage.setItem('stove_macro_auto_claim', 'true');
                setTimeout(() => {
                    window.location.reload();
                }, 800);
                return;
            }
            
            if (this.dataset.status === "ready") {
                if (ABSOLUTE_DRAW_CNT !== null && ABSOLUTE_DRAW_CNT >= MAX_DRAW) {
                    await autoClaimCumulativeRewards();
                    return; 
                }

                isRunning = true;
                this.dataset.status = "running";
                
                while (ABSOLUTE_DRAW_CNT < MAX_DRAW && isRunning) {
                    this.innerHTML = `⏳ 달리는 중...<br><span style="font-size:11px; font-weight:normal;">(클릭 시 정지)</span>`;
                    this.style.backgroundColor = "#ff9800";
                    
                    await executeDraw(); 

                    if (ABSOLUTE_DRAW_CNT < MAX_DRAW && isRunning) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                    }
                }

                if (isRunning && ABSOLUTE_DRAW_CNT >= MAX_DRAW) {
                    isRunning = false;
                    updateCountUI(); 
                    localStorage.setItem('stove_macro_auto_claim', 'true'); 
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                }
            }
        });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        createUI();
    } else {
        window.addEventListener("DOMContentLoaded", createUI);
    }

    if (localStorage.getItem('stove_macro_auto_claim') === 'true') {
        localStorage.removeItem('stove_macro_auto_claim'); 
        setTimeout(() => {
            autoClaimCumulativeRewards();
        }, 2000);
    }

})();
