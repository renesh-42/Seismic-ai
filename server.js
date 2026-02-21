const http = require('http');

const PORT = 3001;

const server = http.createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/predict' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { mag, floors, soil, material } = data;

                // Simple Mock "ML" Model logic (Multivariate regression simulation)
                // In a real scenario, this would load a PyTorch/TensorFlow model
                let prediction = (mag * 8) + (floors * 1.5);

                const soilBias = { clay: 1.25, peat: 1.4, rock: 0.75, sand: 1.1 };
                const matBias = { steel: 0.8, brick: 1.3, adobe: 1.5, wood: 0.7 };

                prediction *= (soilBias[soil.toLowerCase()] || 1.0);
                prediction *= (matBias[material.toLowerCase()] || 1.0);

                // Add stochastic noise to simulate ML variance
                const noise = (Math.random() - 0.5) * 5;
                prediction += noise;

                const result = {
                    damageScore: Math.min(100, Math.max(0, Math.round(prediction * 10) / 10)),
                    confidence: 0.85 + (Math.random() * 0.1),
                    modelTags: ["SeismicAI-v2", "XGBoost-Regressor"],
                    timestamp: new Date().toISOString()
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid data' }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, () => {
    console.log(`Seismic AI ML Backend running at http://localhost:${PORT}`);
});
