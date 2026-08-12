import { Navigate, Route, Routes } from "react-router";
import { EventsHubPage, EventCreatePage, EventDetailPage, EventManagePage, EventRegistrationPage } from "./EventsPages";
import { EventMatchDetailPage, HomePage, MatchesPage, type HomeBridgeProps, type LegacyWeeklyMatch } from "./HomeMatchesPages";
import { ProfilePage } from "./ProfilePage";
import { V2Provider } from "./V2Context";
import { useV2 } from "./useV2";
import { V2Shell } from "./V2Shell";
import { datingServiceMode } from "./service";

export interface V2ExperienceProps extends HomeBridgeProps {
  fallbackDisplayName: string;
  demoMode?: boolean;
  onLogout: () => void;
}

function V2ExperienceRoutes(props: V2ExperienceProps) {
  const { profile, service } = useV2();
  const weeklyMatch = props.weeklyMatch as LegacyWeeklyMatch | null;

  return (
    <V2Shell displayName={profile?.displayName || props.fallbackDisplayName} demoMode={props.demoMode ?? datingServiceMode === "demo"} onResetDemo={() => { void service.resetDemo(); }} onLogout={props.onLogout}>
      <Routes>
        <Route path="/home" element={<HomePage weeklyStatus={props.weeklyStatus} questionnaireStatus={props.questionnaireStatus} weeklyMatch={weeklyMatch} nextRefreshDate={props.nextRefreshDate} onWeeklyToggle={props.onWeeklyToggle} />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/matches" element={<MatchesPage weeklyMatch={weeklyMatch} />} />
        <Route path="/matches/:matchId" element={<EventMatchDetailPage />} />
        <Route path="/events" element={<EventsHubPage />} />
        <Route path="/events/new" element={<EventCreatePage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/events/:eventId/register" element={<EventRegistrationPage questionnaireComplete={props.questionnaireStatus === "completed"} />} />
        <Route path="/events/:eventId/manage" element={<EventManagePage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </V2Shell>
  );
}

export function V2Experience(props: V2ExperienceProps) {
  return <V2Provider><V2ExperienceRoutes {...props} /></V2Provider>;
}
