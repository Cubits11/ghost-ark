import { describe, it, expect } from 'vitest';
import {
    buildOcsfTelemetryEvent,
    exportOcsfEventJson,
    VerdictAction
} from '../../../../packages/research-frontier/src/telemetry/siemExporter';

describe('SIEM Telemetry Exporter (OCSF)', () => {
    it('constructs a strictly compliant OCSF telemetry payload', () => {
        const mockTimestamp = new Date('2026-07-19T03:31:45.000Z');
        
        const payload = buildOcsfTelemetryEvent({
            cgroupId: '18446744073709551615',
            mechanism: 'BPF_LSM_SOCKET_CONNECT',
            action: VerdictAction.EPERM_OUT_OF_BOUNDS,
            canonicalDigest: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
            timestamp: mockTimestamp
        });

        expect(payload.event_time).toBe('2026-07-19T03:31:45.000Z');
        expect(payload.process.cgroup_id).toBe('18446744073709551615');
        expect(payload.enforcement.mechanism).toBe('BPF_LSM_SOCKET_CONNECT');
        expect(payload.verdict.action).toBe('EPERM_OUT_OF_BOUNDS');
        expect(payload.cryptographic.canonical_digest).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');
    });

    it('exports a properly formatted JSON string', () => {
        const jsonStr = exportOcsfEventJson({
            cgroupId: '9999999999',
            mechanism: 'OCC_STATE_REPLICA',
            action: VerdictAction.ABORT_TEMPORAL_DRIFT,
            canonicalDigest: 'f7200aa006c45980070bc0e99dfd70f3fc2ea0c04f46da9dc953493fb0eb5f4f'
        });

        const parsed = JSON.parse(jsonStr);
        expect(parsed.process.cgroup_id).toBe('9999999999');
        expect(parsed.enforcement.mechanism).toBe('OCC_STATE_REPLICA');
        expect(parsed.verdict.action).toBe('ABORT_TEMPORAL_DRIFT');
        expect(parsed.cryptographic.canonical_digest).toBe('f7200aa006c45980070bc0e99dfd70f3fc2ea0c04f46da9dc953493fb0eb5f4f');
        expect(typeof parsed.event_time).toBe('string');
        // Validate ISO 8601 string structure roughly
        expect(parsed.event_time.endsWith('Z')).toBe(true);
    });
});
