/**
 * Open Cybersecurity Schema Framework (OCSF) Telemetry Exporter
 * 
 * Formats Ghost-Ark cryptographic bounds and kernel interceptions into
 * strictly typed OCSF JSON payloads suitable for enterprise SIEM ingestion
 * (e.g., Datadog, Splunk, Elastic).
 */

export enum VerdictAction {
    COMMITTED = 'COMMITTED',
    ABORT_TEMPORAL_DRIFT = 'ABORT_TEMPORAL_DRIFT',
    EPERM_OUT_OF_BOUNDS = 'EPERM_OUT_OF_BOUNDS',
    EPROTONOSUPPORT = 'EPROTONOSUPPORT'
}

export interface OcsfProcessInfo {
    cgroup_id: string; // 64-bit kernel inode represented as a string
}

export interface OcsfEnforcementInfo {
    mechanism: string; // Interception point e.g. BPF_LSM_SOCKET_CONNECT or OCC_STATE_REPLICA
}

export interface OcsfVerdictInfo {
    action: VerdictAction;
}

export interface OcsfCryptographicInfo {
    canonical_digest: string; // SHA-256 HMAC of the evaluation matrix
}

/**
 * Standard OCSF Event Schema for Ghost-Ark Telemetry
 */
export interface OcsfTelemetryEvent {
    event_time: string; // Precise ISO-8601 monotonic clock output
    process: OcsfProcessInfo;
    enforcement: OcsfEnforcementInfo;
    verdict: OcsfVerdictInfo;
    cryptographic: OcsfCryptographicInfo;
}

export interface InterceptEventInput {
    cgroupId: string;
    mechanism: string;
    action: VerdictAction;
    canonicalDigest: string;
    timestamp?: Date;
}

/**
 * Constructs a strict OCSF-compliant JSON schema mapping for a given interception event.
 * 
 * @param event The intercepted event metadata
 * @returns The formatted OcsfTelemetryEvent
 */
export function buildOcsfTelemetryEvent(event: InterceptEventInput): OcsfTelemetryEvent {
    // Default to precise monotonic clock if no timestamp is provided
    const eventTime = (event.timestamp ?? new Date()).toISOString();

    return {
        event_time: eventTime,
        process: {
            cgroup_id: event.cgroupId,
        },
        enforcement: {
            mechanism: event.mechanism,
        },
        verdict: {
            action: event.action,
        },
        cryptographic: {
            canonical_digest: event.canonicalDigest,
        }
    };
}

/**
 * Serializes the OCSF event to a JSON string.
 */
export function exportOcsfEventJson(event: InterceptEventInput): string {
    const ocsfEvent = buildOcsfTelemetryEvent(event);
    return JSON.stringify(ocsfEvent);
}
