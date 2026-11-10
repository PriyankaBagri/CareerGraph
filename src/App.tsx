import { Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { GuestOnly, RequireAuth, RequireUser } from './routes/guards';
import ComingNext from './pages/ComingNext';
import CareerDetail from './pages/CareerDetail';
import CareerEditor from './pages/CareerEditor';
import CareerExplorer from './pages/CareerExplorer';
import Assistant from './pages/Assistant';
import Compare from './pages/Compare';
import Dashboard from './pages/Dashboard';
import EvidencePage from './pages/Evidence';
import ForgotPassword from './pages/ForgotPassword';
import Landing from './pages/Landing';
import Bookings from './pages/Bookings';
import MentorDetail from './pages/MentorDetail';
import Mentors from './pages/Mentors';
import { PaymentCancel, PaymentReturn } from './pages/PaymentResult';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import SkillDetail from './pages/SkillDetail';
import Skills from './pages/Skills';
import Profile from './pages/Profile';
import Roadmap from './pages/Roadmap';
import Settings from './pages/Settings';
import Signup from './pages/Signup';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route element={<RequireUser />}><Route path="/onboarding" element={<Onboarding />} /></Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/career" element={<CareerExplorer />} />
          <Route path="/career/new" element={<CareerEditor />} />
          <Route path="/career/:id" element={<CareerDetail />} />
          <Route path="/career/:id/edit" element={<CareerEditor />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/skills/:id" element={<SkillDetail />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/mentors" element={<Mentors />} />
          <Route path="/mentors/:id" element={<MentorDetail />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/bookings/payment/return" element={<PaymentReturn />} />
          <Route path="/bookings/payment/cancel" element={<PaymentCancel />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<ComingNext title="Page not found" standalone />} />
    </Routes>
  );
}
