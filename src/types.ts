/**
 * 1C:Enterprise BSL AI Copilot Types & Data Contracts
 */

export interface MetadataField {
    name: string;
    synonym?: string;
    type?: string;
}

export interface MetadataObject {
    kind: 'Справочник' | 'Документ' | 'РегистрНакопления' | 'РегистрСведений' | 'ПланВидовХарактеристик' | 'Перечисление';
    name: string;
    synonym?: string;
    tabularSections?: {
        name: string;
        fields: MetadataField[];
    }[];
    fields?: MetadataField[];
}

export interface ConfigurationMetadata {
    name: string;
    version?: string;
    objects: MetadataObject[];
    isDemoFallback?: boolean;
    sourcePath?: string;
}

export interface StandardIssue {
    line: number;
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion: string;
}

export interface NormaHubBalanceInfo {
    balanceRub: number;
    currency: string;
    status: 'active' | 'insufficient_funds' | 'invalid_key' | 'unauthorized';
    error?: string;
}
