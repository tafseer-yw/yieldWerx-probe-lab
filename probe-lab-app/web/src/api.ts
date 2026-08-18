import type {
  LoginResponse,
  ReadinessResponse,
  SampleDataStatus,
  ReferenceValue,
  UploadErrorPage,
  UploadHistoryPage,
  UploadSubmissionResponse,
  BinParetoResponse,
  ClusterDetectionResult,
  ClusterDetectionSummary,
  SignatureMatchResponse,
  UploadSummary,
  WaferDetail,
  WaferPage,
} from '../../shared/contracts.js';

interface ErrorPayload {
  code?: string;
  message?: string;
}

export interface UploadHistoryQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface WaferQuery {
  search?: string;
  lot?: string;
  device?: string;
  program?: string;
  page?: number;
  pageSize?: number;
}

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class WaferIntelligenceApi {
  public constructor(
    private readonly accessToken?: string,
    private readonly onUnauthorized?: () => void,
  ) {}

  public login(username: string, password: string): Promise<LoginResponse> {
    return this.jsonRequest('/api/auth/login', 'POST', { username, password });
  }

  public getReadiness(): Promise<ReadinessResponse> {
    return this.readReadiness();
  }

  public listDevices(): Promise<ReferenceValue[]> {
    return this.request('/api/reference/devices');
  }

  public listTestPrograms(device: string): Promise<ReferenceValue[]> {
    const params = new URLSearchParams({ device });
    return this.request(`/api/reference/test-programs?${params.toString()}`);
  }

  public uploadFile(
    device: string,
    program: string,
    file: File,
  ): Promise<UploadSubmissionResponse> {
    const params = new URLSearchParams({ device, program });
    const form = new FormData();
    form.append('file', file);
    return this.fetchJson(`/api/uploads?${params.toString()}`, { method: 'POST', body: form });
  }

  public uploadCsv(
    device: string,
    program: string,
    csv: string,
  ): Promise<UploadSubmissionResponse> {
    const params = new URLSearchParams({ device, program });
    return this.fetchJson(`/api/uploads?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    });
  }

  public listUploads(query: UploadHistoryQuery): Promise<UploadHistoryPage> {
    return this.request(`/api/uploads${this.querySuffix(query)}`);
  }

  public getUpload(id: string): Promise<UploadSummary> {
    return this.request(`/api/uploads/${id}`);
  }

  public listUploadErrors(id: string, page = 1, pageSize = 50): Promise<UploadErrorPage> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return this.request(`/api/uploads/${id}/errors?${params.toString()}`);
  }

  public listWafers(query: WaferQuery): Promise<WaferPage> {
    return this.request(`/api/wafers${this.querySuffix(query)}`);
  }

  public getSampleData(): Promise<SampleDataStatus> {
    return this.request('/api/sample-data');
  }

  public loadSampleData(keys: string[]): Promise<SampleDataStatus> {
    return this.jsonRequest('/api/sample-data', 'POST', { keys });
  }

  public removeSampleData(keys: string[]): Promise<SampleDataStatus> {
    const suffix = keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : '';
    return this.fetchJson(`/api/sample-data${suffix}`, { method: 'DELETE' });
  }

  public getWafer(waferSequence: number): Promise<WaferDetail> {
    return this.request(`/api/wafers/${waferSequence}`);
  }

  public getSignatureMatch(waferSequence: number): Promise<SignatureMatchResponse> {
    return this.request(`/api/wafers/${waferSequence}/signature-match`);
  }

  public getBinPareto(
    waferSequence: number,
    options: { binType?: string; specifyBins?: string; sortBy?: string; customBins?: number[] },
  ): Promise<BinParetoResponse> {
    const params = new URLSearchParams();
    if (options.binType) params.set('binType', options.binType);
    if (options.specifyBins) params.set('specifyBins', options.specifyBins);
    if (options.sortBy) params.set('sortBy', options.sortBy);
    if (options.customBins && options.customBins.length > 0) {
      params.set('customBins', options.customBins.join(','));
    }
    const suffix = params.toString();
    return this.request(
      `/api/reports/wafers/${waferSequence}/bin-pareto${suffix ? `?${suffix}` : ''}`,
    );
  }

  public getClusterSummary(options: {
    adjacency?: string;
    minimumConnectedDies?: number;
    waferCount?: number;
  }): Promise<ClusterDetectionSummary> {
    const params = new URLSearchParams();
    if (options.adjacency) params.set('adjacency', options.adjacency);
    if (options.minimumConnectedDies !== undefined) {
      params.set('minimumConnectedDies', String(options.minimumConnectedDies));
    }
    if (options.waferCount !== undefined) params.set('waferCount', String(options.waferCount));
    const suffix = params.toString();
    return this.request(`/api/cd/summary${suffix ? `?${suffix}` : ''}`);
  }

  public detectClusters(
    waferSequence: number,
    options: { adjacency?: string; minimumConnectedDies?: number },
  ): Promise<ClusterDetectionResult> {
    const params = new URLSearchParams();
    if (options.adjacency) params.set('adjacency', options.adjacency);
    if (options.minimumConnectedDies !== undefined) {
      params.set('minimumConnectedDies', String(options.minimumConnectedDies));
    }
    const suffix = params.toString();
    return this.request(`/api/cd/wafers/${waferSequence}/clusters${suffix ? `?${suffix}` : ''}`);
  }

  private querySuffix(query: UploadHistoryQuery | WaferQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return suffix ? `?${suffix}` : '';
  }

  private jsonRequest<T>(path: string, method: 'POST' | 'PUT', body: object): Promise<T> {
    return this.fetchJson(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async readReadiness(): Promise<ReadinessResponse> {
    const response = await fetch('/ready', { headers: { accept: 'application/json' } });
    if (response.status === 200 || response.status === 503) {
      return (await response.json()) as ReadinessResponse;
    }
    throw new HttpError(
      response.status,
      'READINESS_FAILED',
      `Readiness check failed with status ${response.status}.`,
    );
  }

  private async request<T>(path: string): Promise<T> {
    return this.fetchJson<T>(path, {});
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);
    headers.set('accept', 'application/json');
    const response = await fetch(path, { ...init, headers });
    if (!response.ok) {
      let payload: ErrorPayload = {};
      try {
        payload = (await response.json()) as ErrorPayload;
      } catch {
        // Preserve the status-based fallback for non-JSON errors.
      }
      if (response.status === 401 && this.accessToken) this.onUnauthorized?.();
      throw new HttpError(
        response.status,
        payload.code ?? 'REQUEST_FAILED',
        payload.message ?? `Request failed with status ${response.status}.`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
