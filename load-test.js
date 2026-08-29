import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics to measure detailed application performance
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');
const analyzeResponseTime = new Trend('analyze_response_time_ms');

export const options = {
  stages: [
    // Stage 1: Baseline ramp up to 10 concurrent users
    { duration: '15s', target: 10 },
    { duration: '20s', target: 10 },

    // Stage 2: Moderate load to 50 concurrent users
    { duration: '20s', target: 50 },
    { duration: '30s', target: 50 },

    // Stage 3: High load to 100 concurrent users
    { duration: '20s', target: 100 },
    { duration: '30s', target: 100 },

    // Stage 4: Heavy load to 250 concurrent users
    { duration: '30s', target: 250 },
    { duration: '30s', target: 250 },

    // Stage 5: Stress load to 500 concurrent users
    { duration: '30s', target: 500 },
    { duration: '30s', target: 500 },

    // Stage 6: Peak stress test scaling up to 1000 concurrent users
    { duration: '30s', target: 1000 },
    { duration: '45s', target: 1000 },

    // Stage 7: Graceful cool down to 0 users
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Target error rate: less than 10% failed requests under high load
    http_req_failed: ['rate<0.10'],
    // 95% of requests should complete within 45 seconds
    http_req_duration: ['p(95)<45000'],
  },
};

export default function () {
  // Target environment host (default to local dev server)
  const targetHost = __ENV.TARGET_HOST || 'http://localhost:3000';

  // Controlled test URL to analyze
  const testUrl = __ENV.TEST_URL || 'https://example.com';

  const endpoint = `${targetHost}/api/analyze`;
  const payload = JSON.stringify({
    url: testUrl,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '60s',
  };

  // Execute request
  const startTime = Date.now();
  const response = http.post(endpoint, payload, params);
  const duration = Date.now() - startTime;

  analyzeResponseTime.add(duration);

  // Validate response status and payload
  const isSuccess = check(response, {
    'HTTP status is 200': (r) => r.status === 200,
    'Response payload success is true': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.success === true;
      } catch (err) {
        return false;
      }
    },
  });

  if (isSuccess) {
    successfulRequests.add(1);
  } else {
    failedRequests.add(1);
  }

  // Realistic user think time (2-5 seconds delay between requests)
  // Simulates realistic traffic while managing request rate to external services
  sleep(Math.random() * 3 + 2);
}
