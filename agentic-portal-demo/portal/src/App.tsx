import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import { LoginPage } from './pages/LoginPage'
import { ForgotPage } from './pages/ForgotPage'
import { HomePage } from './pages/HomePage'
import { VisitsPage } from './pages/VisitsPage'
import { VisitDetailPage } from './pages/VisitDetailPage'
import { CancelPage } from './pages/CancelPage'
import { SchedulePage } from './pages/SchedulePage'
import { CheckinPage } from './pages/CheckinPage'
import { MessagesPage } from './pages/MessagesPage'
import { MessageThreadPage } from './pages/MessageThreadPage'
import { NewMessagePage } from './pages/NewMessagePage'
import { ResultsPage } from './pages/ResultsPage'
import { ResultDetailPage } from './pages/ResultDetailPage'
import { MedicationsPage } from './pages/MedicationsPage'
import { RefillPage } from './pages/RefillPage'
import { HealthSummaryPage } from './pages/HealthSummaryPage'
import { CareTeamPage } from './pages/CareTeamPage'

function Private({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>
}

export function App() {
  return (
    <BrowserRouter basename="/portal">
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/home" element={<Private><HomePage /></Private>} />
          <Route path="/visits" element={<Private><VisitsPage /></Private>} />
          <Route path="/visits/:id" element={<Private><VisitDetailPage /></Private>} />
          <Route path="/visits/:id/cancel" element={<Private><CancelPage /></Private>} />
          <Route path="/visits/:id/checkin" element={<Private><CheckinPage /></Private>} />
          <Route path="/schedule" element={<Private><SchedulePage /></Private>} />
          <Route path="/messages" element={<Private><MessagesPage /></Private>} />
          <Route path="/messages/new" element={<Private><NewMessagePage /></Private>} />
          <Route path="/messages/:id" element={<Private><MessageThreadPage /></Private>} />
          <Route path="/results" element={<Private><ResultsPage /></Private>} />
          <Route path="/results/:id" element={<Private><ResultDetailPage /></Private>} />
          <Route path="/medications" element={<Private><MedicationsPage /></Private>} />
          <Route path="/medications/:id/refill" element={<Private><RefillPage /></Private>} />
          <Route path="/health-summary" element={<Private><HealthSummaryPage /></Private>} />
          <Route path="/care-team" element={<Private><CareTeamPage /></Private>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
