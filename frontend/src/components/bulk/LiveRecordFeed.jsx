import React, { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { ExportToolbar } from '../common/ExportToolbar';
import { CoursesTable } from '../single/CoursesTable';
import { MetricCards } from '../single/MetricCards';
import { StudentProfileHeader } from '../single/StudentProfileHeader';
import { Search, Eye, Radio, CheckCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Real-time streaming feed of records scraped in the current bulk job.
 */
export function LiveRecordFeed({
  records = [],
  jobId,
  isRunning = false,
  onExport,
  className,
}) {
  const [filterText, setFilterText] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);

  const filteredRecords = records.filter((rec) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const usn = (rec.usn || '').toLowerCase();
    const name = (rec.student?.name || '').toLowerCase();
    const status = (rec.summary?.passFail || '').toLowerCase();
    return usn.includes(q) || name.includes(q) || status.includes(q);
  });

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Radio className="h-5 w-5 text-blue-600 animate-pulse" aria-hidden="true" />
          ) : (
            <CheckCircle className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          )}
          <div>
            <CardTitle as="h3">Live Scraped Records Feed</CardTitle>
            <p className="text-xs text-slate-500">
              {records.length} {records.length === 1 ? 'record' : 'records'} captured in this session
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick search input */}
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter batch records..."
              className="rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Export current batch */}
          <ExportToolbar jobId={jobId} disabled={records.length === 0} onExport={onExport} />
        </div>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th scope="col" className="py-3 px-4 sm:px-6">USN</th>
              <th scope="col" className="py-3 px-4">Student Name</th>
              <th scope="col" className="py-3 px-4">Semester</th>
              <th scope="col" className="py-3 px-4 text-center">SGPA</th>
              <th scope="col" className="py-3 px-4 text-center">CGPA</th>
              <th scope="col" className="py-3 px-4 text-center">Status</th>
              <th scope="col" className="py-3 px-4 sm:px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRecords.length > 0 ? (
              filteredRecords.map((record, index) => {
                const usn = record.usn || `USN-${index + 1}`;
                const name = record.student?.name || 'Not Available';
                const semester = record.student?.semester ? `Sem ${record.student.semester}` : '-';
                const sgpa = record.summary?.sgpa || '-';
                const cgpa = record.summary?.cgpa || '-';
                const passFail = record.summary?.passFail || (sgpa !== '-' ? 'PASS' : 'PENDING');
                const isPass = String(passFail).toUpperCase().includes('PASS') || String(passFail).toUpperCase().includes('FIRST');

                return (
                  <tr
                    key={`${usn}-${index}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4 sm:px-6 font-mono text-xs font-bold text-slate-900">
                      {usn}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 max-w-xs truncate">
                      {name}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {semester}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                      {sgpa}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-700">
                      {cgpa}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={isPass ? 'success' : 'danger'} size="sm">
                        {passFail}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 sm:px-6 text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setSelectedRecord(record)}
                        icon={<Eye className="h-3.5 w-3.5" />}
                        className="text-blue-600 hover:text-blue-800"
                        aria-label={`View marks breakdown for ${usn}`}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  {records.length === 0 ? (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-600">
                        {isRunning
                          ? 'Waiting for first student record to finish scraping...'
                          : 'No active bulk job. Configure a range above and click "Start Bulk Scrape".'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm">No records match filter query "{filterText}".</p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Record details inspection modal */}
      {selectedRecord && (
        <Modal
          isOpen={!!selectedRecord}
          onClose={() => setSelectedRecord(null)}
          title={`Student Performance: ${selectedRecord.usn}`}
          size="lg"
          footer={
            <Button variant="secondary" size="sm" onClick={() => setSelectedRecord(null)}>
              Close Details
            </Button>
          }
        >
          <div className="space-y-4">
            <StudentProfileHeader result={selectedRecord} onExport={onExport} />
            <MetricCards summary={selectedRecord.summary || {}} />
            <CoursesTable courses={selectedRecord.courses || []} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

export default LiveRecordFeed;
