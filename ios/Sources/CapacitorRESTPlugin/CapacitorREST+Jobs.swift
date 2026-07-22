import Capacitor

extension CapacitorREST {
    func createJob(_ request: JSObject) -> JobRecord {
        let createdAt = now()
        let jobId = UUID().uuidString
        var jobRequest = request
        jobRequest["jobId"] = jobId
        let job = JobRecord(jobId: jobId, status: "queued", createdAt: createdAt, updatedAt: createdAt, request: jobRequest)
        lock.lock()
        jobs[job.jobId] = job
        lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + options.jobRetentionMs / 1000) { [weak self] in
            guard let self else {
                return
            }
            self.lock.lock()
            if let current = self.jobs[job.jobId], ["queued", "running"].contains(current.status) {
                let updated = current.expired()
                self.jobs[job.jobId] = updated
                self.enforceJobRetentionCapLocked()
                self.emitJobUpdated(updated)
            }
            self.lock.unlock()
        }
        return job
    }

    /// Evicts the oldest terminal-state jobs (never "queued"/"running") once the retained job
    /// count exceeds `options.maxRetainedJobs`, so a client that never calls `deleteJob()` can't
    /// grow the job map - and the full request/response bodies it holds - without bound.
    /// Callers must already hold `lock`.
    func enforceJobRetentionCapLocked() {
        var excess = jobs.count - options.maxRetainedJobs
        if excess <= 0 {
            return
        }
        let terminalStatuses: Set<String> = ["completed", "failed", "cancelled", "expired"]
        let terminalJobs = jobs.values
            .filter { terminalStatuses.contains($0.status) }
            .sorted { $0.createdAt < $1.createdAt }
        for job in terminalJobs {
            if excess <= 0 {
                break
            }
            jobs.removeValue(forKey: job.jobId)
            excess -= 1
        }
    }

    func listJobs(status: String?) -> JSObject {
        lock.lock()
        let jobValues = Array(jobs.values)
        lock.unlock()
        return [
            "jobs": jobValues
                .filter { status == nil || $0.status == status }
                .sorted { $0.createdAt < $1.createdAt }
                .map { $0.toJSObject() }
        ]
    }

    func emitJobUpdated(_ job: JobRecord) {
        bridge?.emit("jobUpdated", ["job": job.toJSObject()])
    }
}
