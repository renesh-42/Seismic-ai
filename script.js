document.addEventListener('DOMContentLoaded', () => {
    // 1. Live Magnitude Display
    const magSlider = document.getElementById('magnitude');
    const magVal = document.getElementById('mag-val');
    const pgaSlider = document.getElementById('pga');
    const pgaVal = document.getElementById('pga-val');

    magSlider.addEventListener('input', (e) => {
        magVal.textContent = parseFloat(e.target.value).toFixed(1);
    });

    pgaSlider.addEventListener('input', (e) => {
        pgaVal.textContent = parseFloat(e.target.value).toFixed(2) + 'g';
    });

    // 2. Seismo-Pulse Background Animation (Canvas-based wave)
    const bg = document.getElementById('bg-animation');
    // We could add more complex JS particle background here if needed

    // 3. Engine Selection Logic
    let currentEngine = 'deterministic';
    const btnDet = document.getElementById('engine-det');
    const btnSci = document.getElementById('engine-sci');
    const femViz = document.getElementById('fem-viz-container');

    btnDet.addEventListener('click', () => {
        currentEngine = 'deterministic';
        btnDet.classList.add('active');
        btnSci.classList.remove('active');
        femViz.style.display = 'none';
        updateSeveritySparkline();
    });

    btnSci.addEventListener('click', () => {
        currentEngine = 'scientific';
        btnSci.classList.add('active');
        btnDet.classList.remove('active');
        femViz.style.display = 'block';
        updateSeveritySparkline();
    });

    // 4. Analysis Logic
    const form = document.getElementById('prediction-form');
    const resultsPanel = document.getElementById('results-panel');
    const damagePercentEl = document.getElementById('damage-percent');
    const riskBadge = document.getElementById('risk-badge');
    const explanationText = document.getElementById('explanation-text');
    const buildingVisual = document.getElementById('building-visual');
    const cracksOverlay = document.getElementById('cracks-overlay');
    const progressCircle = document.querySelector('.progress-ring__circle');
    const radius = progressCircle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;

    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const mag = parseFloat(magSlider.value);
        const pga = parseFloat(pgaSlider.value);
        const soil = document.getElementById('soil-type').value;
        const material = document.getElementById('material').value;
        const floors = parseInt(document.getElementById('floors').value);

        const inputs = { mag, pga, soil, material, floors };

        if (currentEngine === 'scientific') {
            await runScientificAnalysis(inputs);
        } else {
            const damage = calculateTotalDamage(mag, soil, material, floors);
            const componentDamage = calculateComponentDamage(damage, inputs);
            displayResults(damage, componentDamage, inputs);
        }
    });

    async function runScientificAnalysis(inputs) {
        // 1. Structural FEM Displacement Simulation
        const { storyDisplacements } = calculateFEMDisplacement(inputs);
        renderFEMGraph(storyDisplacements);

        // 2. Fetch ML Backend Prediction
        try {
            const response = await fetch('http://localhost:3001/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(inputs)
            });
            const data = await response.json();

            const componentDamage = calculateComponentDamage(data.damageScore, inputs);
            displayResults(data.damageScore, componentDamage, inputs, true);
        } catch (err) {
            console.error('Server offline, falling back to local simulation', err);
            const damage = calculateTotalDamage(inputs.mag, inputs.soil, inputs.material, inputs.floors);
            const componentDamage = calculateComponentDamage(damage, inputs);
            displayResults(damage, componentDamage, inputs);
            alert('ML Backend Offline. Using local fallback simulation.');
        }
    }

    function calculateFEMDisplacement(inputs) {
        const { mag, pga, floors, material } = inputs;
        // Simplified Shear Building Model
        // Displacement delta = Force / Stiffness

        // Material E-Modulus (GPa)
        const eModulus = {
            concrete: 30, steel: 200, brick: 15, wood: 12,
            bamboo: 18, adobe: 5, precast: 35, confined: 25
        };

        const E = eModulus[material.toLowerCase()] || 20;
        const I = 0.05; // Moment of inertia m^4 (placeholder)
        const L = 3.5;  // Story height m

        // Stiffness per floor (kN/m) - Treat as shear building
        const kStory = (12 * E * 1e6 * I) / Math.pow(L, 3);

        // Base shear force calculation: V = Cs * W
        // Approximating Cs (Seismic Response Coefficient) using PGA
        const seismicWeightPerFloor = 5000; // kN (placeholder)
        const totalWeight = floors * seismicWeightPerFloor;
        const Cs = pga; // Simplified: Cs is proportional to PGA
        const baseShear = Cs * totalWeight;

        let storyDisplacements = [];
        let cumulativeDisplacement = 0;

        for (let i = 1; i <= floors; i++) {
            // Simplified linear force distribution (triangular)
            const floorForce = baseShear * (i / floors);
            const drift = floorForce / kStory;
            cumulativeDisplacement += drift;
            storyDisplacements.push({
                floor: i,
                drift: Math.round(drift * 1000 * 10) / 10, // mm
                total: Math.round(cumulativeDisplacement * 1000)
            });
        }
        return { storyDisplacements, baseShear };
    }

    let femChart = null;
    function renderFEMGraph(data) {
        const ctx = document.getElementById('fem-graph').getContext('2d');

        const labels = data.map(d => `F${d.floor}`);
        const driftValues = data.map(d => d.drift);

        if (femChart) femChart.destroy();

        femChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Inter-storey Drift (mm)',
                    data: driftValues,
                    backgroundColor: 'rgba(183, 28, 28, 0.4)',
                    borderColor: '#B71C1C',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#888' } },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#888' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function calculateTotalDamage(mag, soilRaw, materialRaw, floors) {
        let damage = 0;
        const soil = (soilRaw || '').toLowerCase();
        const material = (materialRaw || '').toLowerCase();

        if (mag > 7 && (soil === 'clay' || soil === 'peat' || soil === 'fill')) {
            damage = 80 + (mag - 7) * 5;
        } else if (mag >= 5 && mag <= 6 && soil === 'rock') {
            damage = 40 + (mag - 5) * 20;
        } else if (mag < 5) {
            damage = 10 + (mag / 5) * 20;
        } else {
            let base = (mag / 9) * 70;
            const soilMultipliers = {
                'clay': 1.3, 'sand': 1.1, 'loam': 1.0, 'rock': 0.8,
                'silt': 1.2, 'peat': 1.5, 'gravel': 0.9, 'fill': 1.4, 'chalk': 1.0
            };
            const materialMultipliers = {
                'concrete': 1.0, 'steel': 0.8, 'brick': 1.2,
                'wood': 0.7, 'bamboo': 0.7, 'adobe': 1.6, 'precast': 1.1, 'confined': 0.9
            };

            damage = base * (soilMultipliers[soil] || 1.0);
            damage *= (materialMultipliers[material] || 1.0);

            if (floors > 10) damage *= 1.1;
        }
        return Math.min(Math.round(damage), 100);
    }

    function calculateComponentDamage(total, inputs) {
        const mag = inputs.mag;
        const soil = (inputs.soil || '').toLowerCase();
        const material = (inputs.material || '').toLowerCase();
        const floors = inputs.floors;

        // Base damage for all components tends towards total
        let foundation = total * 0.8;
        let pillars = total * 0.85;
        let walls = total * 0.9;
        let roof = total * 0.7;
        let utilities = total * 1.1; // Utilities often fail even with low structural damage

        // Specific Heuristics
        if (soil === 'clay' || soil === 'peat' || soil === 'fill') foundation += 15;
        if (soil === 'rock') foundation -= 10;

        if (floors > 8) pillars += 10;
        if (material === 'brick' || material === 'adobe') walls += 15;
        if (material === 'steel' || material === 'wood' || material === 'bamboo') pillars -= 5;

        // Cap each component at 100 and floor at 10 (unless total is 0)
        const cap = (val) => total === 0 ? 0 : Math.min(100, Math.max(10, Math.round(val)));

        return {
            foundation: cap(foundation),
            pillars: cap(pillars),
            walls: cap(walls),
            roof: cap(roof),
            utilities: cap(utilities)
        };
    }

    let componentChart = null;

    function setProgress(percent) {
        const offset = circumference - (percent / 100 * circumference);
        progressCircle.style.strokeDashoffset = offset;
    }

    function displayResults(damage, components, inputs) {
        resultsPanel.style.display = 'block';

        // Reset animations
        buildingVisual.style.animation = 'none';
        buildingVisual.offsetHeight; // trigger reflow

        // Counter animation for percent
        let current = 0;
        const interval = setInterval(() => {
            if (current >= damage) {
                clearInterval(interval);
            } else {
                current++;
                damagePercentEl.textContent = current;
                setProgress(current);
            }
        }, 20);

        // Update Base Shear Display
        const baseShearText = document.getElementById('base-shear-text');
        // If scientific, we have the exact value, otherwise estimate
        let baseShearVal = 0;
        if (currentEngine === 'scientific') {
            const femData = calculateFEMDisplacement(inputs);
            baseShearVal = femData.baseShear;
        } else {
            // Qualitative estimation for deterministic mode
            baseShearVal = inputs.mag * 4500 * (inputs.floors / 5) * (inputs.pga * 4);
        }
        baseShearText.textContent = `${(baseShearVal / 1000).toFixed(2)} MN`;

        // Update Radar Chart
        updateChart(components);

        // Dynamic Explanation
        explanationText.textContent = generateDynamicExplanation(damage, inputs);

        // Risk Levels
        const riskText = document.getElementById('risk-text');
        const riskIcon = document.getElementById('risk-icon');

        if (damage < 35) {
            riskBadge.className = 'badge';
            riskBadge.style.background = 'var(--risk-low)';
            riskText.textContent = 'Low (Safe)';
            riskIcon.setAttribute('data-lucide', 'shield-check');
            cracksOverlay.style.opacity = '0';
        } else if (damage < 70) {
            riskBadge.className = 'badge';
            riskBadge.style.background = 'var(--risk-moderate)';
            riskText.textContent = 'Moderate (Caution)';
            riskIcon.setAttribute('data-lucide', 'alert-triangle');
            cracksOverlay.style.opacity = '0.5';
            buildingVisual.style.animation = 'shake 0.5s infinite';
        } else {
            riskBadge.className = 'badge';
            riskBadge.style.background = 'var(--risk-severe)';
            riskText.textContent = 'Severe (Danger)';
            riskIcon.setAttribute('data-lucide', 'alert-octagon');
            runFailureSequence(); // Dramatic sequence
        }

        // Analysis Logic For Seismic Zone
        const zoneBadge = document.getElementById('seismic-zone-badge');
        const zoneText = document.getElementById('zone-text');
        const zoneIcon = document.getElementById('zone-icon');

        let zoneName = '';
        let zoneDesc = '';
        let zoneColor = '';
        let zoneLucideIcon = 'info';

        if (mag < 4.5) {
            zoneName = 'Zone II';
            zoneDesc = 'Low Risk';
            zoneColor = 'var(--risk-low)';
            zoneLucideIcon = 'shield';
        } else if (mag < 6.0) {
            zoneName = 'Zone III';
            zoneDesc = 'Moderate Risk';
            zoneColor = 'var(--risk-moderate)';
            zoneLucideIcon = 'info';
        } else if (mag < 7.5) {
            zoneName = 'Zone IV';
            zoneDesc = 'High Risk';
            zoneColor = 'var(--zone-high)';
            zoneLucideIcon = 'alert-triangle';
        } else {
            zoneName = 'Zone V';
            zoneDesc = 'Very Severe Risk';
            zoneColor = 'var(--zone-severe)';
            zoneLucideIcon = 'alert-circle';
        }

        zoneBadge.style.background = zoneColor;
        zoneText.textContent = `${zoneName} (${zoneDesc})`;
        zoneIcon.setAttribute('data-lucide', zoneLucideIcon);

        // Stochastic & Sensitivity Analysis
        const confidenceRangeEl = document.getElementById('confidence-range');
        const confidenceVal = calculateConfidenceInterval(mag, inputs.soil);
        confidenceRangeEl.textContent = `±${confidenceVal}%`;

        renderSensitivityAnalysis(damage, inputs);

        // Re-initialize Lucide for the new icon
        if (window.lucide) {
            lucide.createIcons();
        }

        resultsPanel.scrollIntoView({ behavior: 'smooth' });
    }

    function calculateConfidenceInterval(mag, soilRaw) {
        const soil = (soilRaw || '').toLowerCase();
        let base = 5;
        if (mag > 7.0) base += 5;
        if (soil === 'peat' || soil === 'fill') base += 5;
        if (soil === 'rock') base -= 2;
        return base;
    }

    function renderSensitivityAnalysis(totalDamage, inputs) {
        const container = document.getElementById('sensitivity-drivers');
        if (!container) return;

        const { mag, soil, material, floors } = inputs;

        // Calculate relative weights (simplified sensitivity)
        const drivers = [
            { label: 'Magnitude', weight: (mag / 9) * 100 },
            { label: 'Soil Factor', weight: getSoilWeight(soil) },
            { label: 'Ductility', weight: getMaterialWeight(material) },
            { label: 'Resonance', weight: Math.min(100, (floors / 20) * 100) }
        ];

        // Sort by weight descending
        drivers.sort((a, b) => b.weight - a.weight);

        container.innerHTML = drivers.map(d => `
            <div class="driver-item">
                <span class="driver-label">${d.label}</span>
                <div class="driver-bar-bg">
                    <div class="driver-bar-fill" style="width: ${d.weight}%"></div>
                </div>
                <span class="driver-value">${Math.round(d.weight)}%</span>
            </div>
        `).join('');
    }

    function getSoilWeight(soilRaw) {
        const soil = (soilRaw || '').toLowerCase();
        const weights = {
            'clay': 85, 'peat': 95, 'fill': 90, 'sand': 75,
            'loam': 60, 'rock': 30, 'gravel': 40, 'silt': 80, 'chalk': 50
        };
        return weights[soil] || 50;
    }

    function getMaterialWeight(matRaw) {
        const mat = (matRaw || '').toLowerCase();
        const weights = {
            'brick': 90, 'adobe': 95, 'concrete': 60, 'precast': 75,
            'steel': 40, 'wood': 35, 'bamboo': 30, 'confined': 55
        };
        return weights[mat] || 50;
    }

    function runFailureSequence() {
        const debris = document.getElementById('debris-overlay');

        // Reset states
        buildingVisual.className = 'building';
        cracksOverlay.style.opacity = '0';
        debris.className = 'debris';

        // Stage 1: Intense Vibration (Initial shock)
        buildingVisual.classList.add('shake-intense', 'critical-flash');

        // Stage 2: Cracks Spreading (0.8s later)
        setTimeout(() => {
            cracksOverlay.style.opacity = '1';
            cracksOverlay.style.transform = 'scale(1.1)';
        }, 800);

        // Stage 3: Structural Failure & Debris (1.5s later)
        setTimeout(() => {
            buildingVisual.classList.remove('shake-intense');
            buildingVisual.classList.add('structural-failure');
            debris.classList.add('debris-cloud');
        }, 1500);
    }

    function generateDynamicExplanation(damage, inputs) {
        const mag = inputs.mag;
        const soil = (inputs.soil || '').toLowerCase();
        const material = (inputs.material || '').toLowerCase();
        const floors = inputs.floors;

        let reasons = [];

        // Magnitude/PGA explanation
        if (mag >= 7.5 || inputs.pga > 0.6) reasons.push(`high Peak Ground Acceleration (PGA) from a ${mag} Mw event`);
        else if (mag >= 6.0 || inputs.pga > 0.3) reasons.push(`significant ground motion at ${inputs.pga}g PGA`);
        else reasons.push(`moderate seismic vibrations`);

        // Soil contribution
        if (soil === 'clay' || soil === 'peat' || soil === 'fill') reasons.push(`soil amplification in unstable ground layers`);
        else if (soil === 'rock' || soil === 'gravel') reasons.push(`the stability of dense foundation materials`);

        // Material/Structure
        if ((material === 'brick' || material === 'adobe') && damage > 50) reasons.push(`the low ductility of traditional masonry`);
        else if ((material === 'steel' || material === 'wood' || material === 'bamboo') && damage < 40) reasons.push(`the superior flexural strength and ductility of the structure`);

        if (floors > 10) reasons.push(`increased inter-storey drift in this high-rise structure`);

        // Construct final string
        const baseMessage = `This ${damage}% damage prediction is primarily driven by ${reasons[0]}. `;
        const secondaryFactor = reasons.length > 1 ? `The result was further influenced by ${reasons.slice(1).join(' and ')}.` : '';

        return baseMessage + secondaryFactor;
    }

    function updateChart(components) {
        const ctx = document.getElementById('component-chart').getContext('2d');

        const data = {
            labels: ['Foundation', 'Pillars', 'Walls', 'Roof', 'Utilities'],
            datasets: [{
                label: 'Damage %',
                data: [
                    components.foundation,
                    components.pillars,
                    components.walls,
                    components.roof,
                    components.utilities
                ],
                fill: true,
                backgroundColor: 'rgba(183, 28, 28, 0.2)',
                borderColor: '#B71C1C',
                pointBackgroundColor: '#B71C1C',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#B71C1C'
            }]
        };

        const config = {
            type: 'radar',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        pointLabels: { color: '#aaa', font: { size: 12 } },
                        ticks: { display: false, stepSize: 20 },
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        };

        if (componentChart) {
            componentChart.destroy();
        }
        componentChart = new Chart(ctx, config);
    }

    let sparklineChart = null;
    function updateSeveritySparkline() {
        const soil = document.getElementById('soil-type').value;
        const material = document.getElementById('material').value;
        const floors = parseInt(document.getElementById('floors').value || 5);

        const labels = Array.from({ length: 9 }, (_, i) => i + 1);
        const data = labels.map(m => calculateTotalDamage(m, soil, material, floors));

        const ctx = document.getElementById('severity-sparkline').getContext('2d');

        if (sparklineChart) sparklineChart.destroy();

        sparklineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    borderColor: 'rgba(183, 28, 28, 0.5)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    backgroundColor: 'rgba(183, 28, 28, 0.05)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { display: false },
                    y: { display: false, min: 0, max: 100 }
                }
            }
        });
    }

    // Trigger sparkline on any input change
    ['magnitude', 'pga', 'soil-type', 'material', 'floors'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateSeveritySparkline);
    });
    updateSeveritySparkline(); // Initial load

    // 4. Map Initialization
    const initMap = () => {
        const map = L.map('map', {
            zoomControl: false,
            scrollWheelZoom: true
        }).setView([20, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(map);

        // Sample Earthquakes
        const samples = [
            { pos: [35.6762, 139.6503], mag: 7.9, name: "Great Kanto (1923)" },
            { pos: [34.0522, -118.2437], mag: 6.7, name: "Northridge (1994)" },
            { pos: [38.3229, 142.3690], mag: 9.1, name: "Tohoku (2011)" },
            { pos: [-38.297, -73.05], mag: 9.5, name: "Valdivia, Chile (1960)" },
            { pos: [61.02, -147.65], mag: 9.2, name: "Great Alaska (1964)" },
            { pos: [3.316, 95.854], mag: 9.1, name: "Indian Ocean (2004)" },
            { pos: [18.457, -72.533], mag: 7.0, name: "Haiti (2010)" },
            { pos: [37.75, -122.51], mag: 7.9, name: "San Francisco (1906)" },
            { pos: [28.231, 84.731], mag: 7.8, name: "Gorkha, Nepal (2015)" },
            { pos: [18.19, -102.53], mag: 8.1, name: "Mexico City (1985)" },
            { pos: [37.17, 37.03], mag: 7.8, name: "Kahramanmaraş, Turkey (2023)" }
        ];

        samples.forEach(s => {
            const color = s.mag > 8 ? '#ff4444' : (s.mag > 6 ? '#ffcc00' : '#B71C1C');
            L.circleMarker(s.pos, {
                radius: s.mag * 2,
                color: color,
                fillColor: color,
                fillOpacity: 0.5
            }).addTo(map).bindPopup(`<b>${s.name}</b><br>Magnitude: ${s.mag} Mw`);
        });
    };

    if (document.getElementById('map')) initMap();

    // 5. Scroll Reveal
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.section-padding').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        observer.observe(el);
    });

    // Custom visible class for observer
    const styleAttr = document.createElement('style');
    styleAttr.innerHTML = `
        .section-padding.visible { opacity: 1 !important; transform: translateY(0) !important; }
        @keyframes shake {
            0% { transform: translate(1px, 1px) rotate(0deg); }
            10% { transform: translate(-1px, -2px) rotate(-1deg); }
            20% { transform: translate(-3px, 0px) rotate(1deg); }
            30% { transform: translate(3px, 2px) rotate(0deg); }
            40% { transform: translate(1px, -1px) rotate(1deg); }
            50% { transform: translate(-1px, 2px) rotate(-1deg); }
            60% { transform: translate(-3px, 1px) rotate(0deg); }
            70% { transform: translate(3px, 1px) rotate(-1deg); }
            80% { transform: translate(-1px, -1px) rotate(1deg); }
            90% { transform: translate(1px, 2px) rotate(0deg); }
            100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
    `;
    document.head.appendChild(styleAttr);

    // 6. Stats Counter Animation
    const stats = document.querySelectorAll('.stat-number');
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = +entry.target.getAttribute('data-target');
                let count = 0;
                const update = () => {
                    const inc = target / 50;
                    if (count < target) {
                        count += inc;
                        entry.target.innerText = Math.ceil(count);
                        setTimeout(update, 20);
                    } else {
                        entry.target.innerText = target;
                    }
                };
                update();
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    stats.forEach(s => statsObserver.observe(s));

    // 7. PDF Generation (Simple print view)
    document.getElementById('download-report').addEventListener('click', () => {
        window.print();
    });

    // 8. LocalStorage Save & History Management
    const historyBody = document.getElementById('history-body');
    const noHistory = document.getElementById('no-history');

    function renderHistory() {
        const history = JSON.parse(localStorage.getItem('seismo_history') || '[]');

        if (history.length === 0) {
            noHistory.style.display = 'block';
            document.getElementById('history-table').style.display = 'none';
            return;
        }

        noHistory.style.display = 'none';
        document.getElementById('history-table').style.display = 'table';

        historyBody.innerHTML = history.reverse().map(item => `
            <tr>
                <td>${new Date(item.date).toLocaleDateString()} ${new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>${item.magnitude} Mw / ${item.pga}g</td>
                <td>${item.soil || 'N/A'}</td>
                <td><span class="accent">${item.damage}%</span></td>
                <td><span class="badge" style="background: ${getRiskColor(item.damage)}">${getRiskLevel(item.damage)}</span></td>
            </tr>
        `).join('');
    }

    function getRiskColor(damage) {
        if (damage < 35) return '#B71C1C';
        if (damage < 70) return '#ffcc00';
        return '#ff4444';
    }

    function getRiskLevel(damage) {
        if (damage < 35) return 'Low';
        if (damage < 70) return 'Moderate';
        return 'Severe';
    }

    document.getElementById('save-history').addEventListener('click', () => {
        const history = JSON.parse(localStorage.getItem('seismo_history') || '[]');
        const entry = {
            date: new Date().toISOString(),
            damage: damagePercentEl.textContent,
            magnitude: magSlider.value,
            pga: pgaSlider.value,
            soil: document.getElementById('soil-type').value
        };
        history.push(entry);
        localStorage.setItem('seismo_history', JSON.stringify(history));
        renderHistory(); // Refresh table
        alert('Analysis saved to local history!');
    });

    // 9. Unit Converter Logic
    const convM = document.getElementById('conv-m');
    const convFt = document.getElementById('conv-ft');
    const applyHeight = document.getElementById('apply-height');
    const applyPillar = document.getElementById('apply-pillar');

    convM.addEventListener('input', () => {
        const val = parseFloat(convM.value);
        if (!isNaN(val)) convFt.value = (val * 3.28084).toFixed(2);
        else convFt.value = '';
    });

    convFt.addEventListener('input', () => {
        const val = parseFloat(convFt.value);
        if (!isNaN(val)) convM.value = (val / 3.28084).toFixed(2);
        else convM.value = '';
    });

    applyHeight.addEventListener('click', () => {
        if (convM.value) {
            document.getElementById('height').value = convM.value;
            // Trigger sparkline update
            updateSeveritySparkline();
        }
    });

    applyPillar.addEventListener('click', () => {
        if (convM.value) {
            document.getElementById('pillar').value = convM.value;
            // Trigger sparkline update
            updateSeveritySparkline();
        }
    });

    // Initial render
    renderHistory();
});
