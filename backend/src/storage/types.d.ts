/**
 * Course grade entry from scraped portal table
 */
export interface CourseGrade {
    'COURSE CODE'?: string;
    'COURSE NAME'?: string;
    courseCode?: string;
    courseName?: string;
    CIE?: string | number;
    SEE?: string | number;
    TOTAL?: string | number;
    'CREDITS REG.'?: string | number;
    'CREDITS EARNED'?: string | number;
    creditsRegistered?: string | number;
    creditsEarned?: string | number;
    GRADE?: string;
    grade?: string;
    [key: string]: any;
}

/**
 * Student demographic info
 */
export interface StudentInfo {
    name: string;
    srn: string;
    department: string;
    semester: string;
}

/**
 * Academic performance summary
 */
export interface ResultSummary {
    creditsRegistered: string;
    creditsEarned: string;
    sgpa: string;
    cgpa: string;
}

/**
 * Persisted student result entity
 */
export interface ResultRecord {
    id: string;
    usn: string;
    exam: string;
    student: StudentInfo;
    summary: ResultSummary;
    courses: CourseGrade[];
    scrapedAt: string;
    updatedAt: string;
}

/**
 * Filter options for querying results
 */
export interface ResultsFilter {
    usn?: string;
    search?: string;
    semester?: string | number;
    department?: string;
    exam?: string;
    minSgpa?: number | string;
    maxSgpa?: number | string;
    minCgpa?: number | string;
    maxCgpa?: number | string;
    status?: 'PASS' | 'FAIL' | 'ALL';
    sortBy?: 'scrapedAt' | 'usn' | 'name' | 'sgpa' | 'cgpa' | 'semester';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number | 'all';
}

/**
 * Paginated results response
 */
export interface PaginatedResults<T> {
    results: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * Bulk job status enumeration
 */
export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Error entry logged during bulk scraping
 */
export interface JobError {
    usn?: string;
    error: string;
    timestamp: string;
}

/**
 * Persisted bulk scraper job entity
 */
export interface JobRecord {
    jobId: string;
    id: string;
    fromUsn: string;
    toUsn: string;
    examId: string | null;
    status: JobStatus;
    total: number;
    processed: number;
    successful: number;
    failed: number;
    currentUsn: string | null;
    results: any[];
    errors: JobError[];
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * Progress updates for a bulk scraping job
 */
export interface JobProgressUpdate {
    status?: JobStatus;
    total?: number;
    processed?: number;
    successful?: number;
    failed?: number;
    incrementProcessed?: number;
    incrementSuccessful?: number;
    incrementFailed?: number;
    currentUsn?: string | null;
    newResult?: any;
    newResults?: any[];
    newError?: JobError | string;
    newErrors?: (JobError | string)[];
}

/**
 * Filter options for querying bulk jobs
 */
export interface JobsFilter {
    status?: string;
    sortBy?: 'createdAt' | 'updatedAt' | 'total' | 'processed';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number | 'all';
}

/**
 * Paginated jobs response
 */
export interface PaginatedJobs<T> {
    jobs: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * Repository interface for student results
 */
export interface IResultsRepository {
    saveResult(resultData: any): Promise<ResultRecord>;
    saveResultsBatch(resultsList: any[]): Promise<ResultRecord[]>;
    getResultByUsn(usn: string): Promise<ResultRecord | null>;
    getResultsByUsn(usn: string): Promise<ResultRecord[]>;
    getResultById(id: string): Promise<ResultRecord | null>;
    getAllResults(filter?: ResultsFilter): Promise<PaginatedResults<ResultRecord>>;
    deleteResult(idOrUsn: string): Promise<boolean>;
    countResults(filter?: ResultsFilter): Promise<number>;
    clearResults(): Promise<void>;
}

/**
 * Repository interface for bulk scraping jobs
 */
export interface IJobsRepository {
    saveJob(jobData: any): Promise<JobRecord>;
    getJob(jobId: string): Promise<JobRecord | null>;
    updateJobProgress(jobId: string, updates: JobProgressUpdate): Promise<JobRecord>;
    getAllJobs(filter?: JobsFilter): Promise<PaginatedJobs<JobRecord>>;
    deleteJob(jobId: string): Promise<boolean>;
    clearJobs(): Promise<void>;
}
