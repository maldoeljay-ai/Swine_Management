// FarmInvite.jsx
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { dataAPI, getActiveFarm, setActiveFarm } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline } from '../lib/sync';

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) { }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ─── Notification → Activity category maps ───────────────────────
const NOTIF_CATEGORY = {
  pig_added:           { key: 'pig',      label: 'Pig Mgmt',  icon: 'fa-piggy-bank',           color: '#8b5cf6' },
  mating_added:        { key: 'breeding', label: 'Breeding',  icon: 'fa-heart',                color: '#ec4899' },
  farrowing_recorded:  { key: 'breeding', label: 'Breeding',  icon: 'fa-baby',                 color: '#ec4899' },
  weaning_recorded:    { key: 'breeding', label: 'Breeding',  icon: 'fa-seedling',             color: '#ec4899' },
  feed_logged:         { key: 'feed',     label: 'Feeding',   icon: 'fa-utensils',             color: '#10b981' },
  low_stock:           { key: 'feed',     label: 'Feeding',   icon: 'fa-exclamation-triangle', color: '#10b981' },
  missed_feeding:      { key: 'feed',     label: 'Feeding',   icon: 'fa-clock',                color: '#10b981' },
  health_recorded:     { key: 'health',   label: 'Health',    icon: 'fa-heartbeat',            color: '#ef4444' },
  health_treatment:    { key: 'health',   label: 'Health',    icon: 'fa-stethoscope',          color: '#ef4444' },
  vaccination_due:     { key: 'health',   label: 'Health',    icon: 'fa-syringe',              color: '#ef4444' },
  vaccination_overdue: { key: 'health',   label: 'Health',    icon: 'fa-syringe',              color: '#ef4444' },
  growth_recorded:     { key: 'growth',   label: 'Growth',    icon: 'fa-chart-line',           color: '#3b82f6' },
  mortality_recorded:  { key: 'growth',   label: 'Growth',    icon: 'fa-skull',                color: '#3b82f6' },
};

const NOTIF_TITLE = {
  pig_added: 'Pig Added', mating_added: 'Mating Recorded',
  farrowing_recorded: 'Farrowing Recorded', weaning_recorded: 'Weaning Recorded',
  feed_logged: 'Feed Logged', low_stock: 'Low Stock Alert', missed_feeding: 'Missed Feeding',
  health_recorded: 'Health Record Added', health_treatment: 'Treatment Applied',
  vaccination_due: 'Vaccination Due', vaccination_overdue: 'Vaccination Overdue',
  growth_recorded: 'Growth Recorded', mortality_recorded: 'Mortality Reported',
};

export default function FarmInvite({ profile, onFarmChange }) {
  const [online, setOnline] = useState(isOnline());
  const [farm, setFarm] = useState(null);
  const [members, setMembers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [isCreatingFarm, setIsCreatingFarm] = useState(false);
  const [viewingCaretaker, setViewingCaretaker] = useState(null);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const activeFarmId = getActiveFarm();
  const isOwner = profile?.role === 'Owner';
  const canJoin = profile?.role !== 'Owner';

  const hasFarm = isOwner && profile?.farm_id === profile?.id;
  const hasJoinedFarm = !isOwner && profile?.supervisor_id !== null;

  const realtimeRef = useRef(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (profile?.id) {
      loadFarmData();
      subscribeToMembers();
    }
    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, [activeFarmId, profile?.id]);

  function subscribeToMembers() {
    const farmId = isOwner ? profile?.id : profile?.supervisor_id;
    if (!farmId) return;
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current);
    const channel = supabase
      .channel(`farm_members_${farmId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `farm_id=eq.${farmId}` },
        () => { loadFarmData(); }
      )
      .subscribe();
    realtimeRef.current = channel;
  }

  async function loadFarmData() {
    setLoading(true);
    try {
      let farmId = null;
      if (isOwner) farmId = profile?.farm_id || null;
      else farmId = profile?.supervisor_id || null;

      if (farmId) {
        const ownerProfile = await dataAPI.profiles.getById(farmId);
        if (ownerProfile) {
          setFarm({
            id: ownerProfile.id,
            name: `${ownerProfile.username || 'Owner'}'s Farm`,
            invite_code: ownerProfile.invite_code,
          });
        }
        const profileData = await dataAPI.profiles.getAll();
        setAllProfiles(profileData);
        setMembers(profileData.filter(p => p.supervisor_id === farmId));
      } else {
        setFarm(null);
        setMembers([]);
      }
    } catch (err) {
      console.error('Error loading farm data:', err);
    }
    setLoading(false);
  }

  async function createFarm() {
    if (!isOwner) return;
    setIsCreatingFarm(true);
    try {
      await dataAPI.profiles.update(profile.id, { farm_id: profile.id });
      setActiveFarm(profile.id);
      await loadFarmData();
      if (onFarmChange) onFarmChange(profile.id);
      Swal.fire({ icon: 'success', title: 'Farm Created!', text: 'Your farm is now active. You can now generate an invite code to add caretakers.', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Error', 'Failed to create farm: ' + err.message, 'error');
    } finally {
      setIsCreatingFarm(false);
    }
  }

  async function generateCode() {
    if (!farm) return;
    setGenerating(true);
    try {
      const code = generateInviteCode();
      await dataAPI.profiles.update(profile.id, { invite_code: code });
      setFarm(prev => ({ ...prev, invite_code: code }));
      await Swal.fire({
        title: '🎉 Invite Code Generated!',
        html: `
          <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#059669;
                      font-family:monospace;margin:16px 0;padding:14px 24px;
                      background:#ecfdf5;border-radius:12px;display:inline-block;
                      box-shadow:0 2px 8px rgba(5,150,105,0.15)">
            ${code}
          </div>
          <div style="color:#6b7280;font-size:13px;margin-top:10px">
            Share this code with your caretakers so they can join your farm.
          </div>`,
        icon: 'success',
        confirmButtonColor: '#059669',
        confirmButtonText: '📋 Copy & Close',
      });
      await copyToClipboard(code);
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
    setGenerating(false);
  }

  async function revokeCode() {
    const result = await Swal.fire({
      title: 'Revoke invite code?',
      text: 'The current code will be invalidated. No new caretakers can join with it.',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: 'Revoke',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.profiles.update(profile.id, { invite_code: null });
      setFarm(prev => ({ ...prev, invite_code: null }));
      Swal.fire('Revoked', 'Invite code has been removed.', 'success');
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }

  async function removeMember(memberId, memberName) {
    const result = await Swal.fire({
      title: `Remove ${memberName}?`,
      text: 'This will remove them from the farm. They can rejoin with an invite code.',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: 'Remove',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.profiles.update(memberId, { farm_id: memberId, supervisor_id: null });
      await loadFarmData();
      Swal.fire('Removed', `${memberName} has been removed from the farm.`, 'success');
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }

  async function joinFarm() {
    const code = joinCode.trim().toUpperCase();
    if (!code || code.length < 6) {
      Swal.fire('Error', 'Please enter a valid invite code (at least 6 characters).', 'error');
      return;
    }
    if (!profile?.id) {
      Swal.fire('Error', 'You must be logged in.', 'error');
      return;
    }
    setJoining(true);
    try {
      const allProfilesList = await dataAPI.profiles.getAll();
      const matched = allProfilesList.find(p => p.invite_code && p.invite_code.toUpperCase() === code);

      if (!matched) {
        Swal.fire({ title: 'Invalid Code', text: 'No farm found with that invite code. Please check the code with your farm owner.', icon: 'error', confirmButtonColor: '#059669' });
        setJoining(false);
        return;
      }

      if (profile.farm_id === matched.id) {
        Swal.fire({ title: 'Already a Member', html: `You are already a member of <strong>${matched.username || 'this'}'s Farm</strong>.`, icon: 'info', confirmButtonColor: '#059669' });
        setJoining(false);
        return;
      }

      await dataAPI.profiles.update(profile.id, { supervisor_id: matched.id, farm_id: matched.id });

      try {
        await dataAPI.farm_members.insert({ farm_id: matched.id, user_id: profile.id, role: profile.role || 'Farm Caretaker' });
      } catch (e) {}

      setActiveFarm(matched.id);

      await Swal.fire({
        title: '🎉 Joined Farm!',
        html: `<div style="font-size:16px">You are now a member of <strong>${matched.username || 'the owner'}'s Farm</strong>!</div>
               <div style="color:#6b7280;margin-top:8px;font-size:13px">You can now access farm data.</div>`,
        icon: 'success', confirmButtonColor: '#059669',
      });

      await loadFarmData();
      if (onFarmChange) onFarmChange(matched.id);
      setJoinCode('');
      setShowJoinInput(false);
    } catch (err) {
      console.error('joinFarm error:', err);
      Swal.fire('Error', err.message || 'Failed to join farm. Please try again.', 'error');
    }
    setJoining(false);
  }

  async function handleCopy() {
    if (!farm?.invite_code) return;
    await copyToClipboard(farm.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getRoleStyle(role) {
    switch ((role || '').toLowerCase()) {
      case 'owner': return { bg: '#dbeafe', color: '#1d4ed8', icon: 'fa-crown' };
      case 'admin': return { bg: '#ede9fe', color: '#6d28d9', icon: 'fa-shield-alt' };
      case 'farm caretaker': return { bg: '#d1fae5', color: '#065f46', icon: 'fa-user-cog' };
      default: return { bg: '#f3f4f6', color: '#6b7280', icon: 'fa-user' };
    }
  }

  function handleMemberClick(memberProfile) {
    if (!isOwner) return;
    const roleStyle = getRoleStyle((memberProfile?.role || '').toLowerCase());
    const displayName = memberProfile?.username || memberProfile?.email?.split('@')[0] || 'Unknown User';
    const joinedDate = memberProfile.created_at ? new Date(memberProfile.created_at).toLocaleDateString() : 'Unknown';

    Swal.fire({
      html: `
        <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
          <div style="background:${roleStyle.bg};color:${roleStyle.color};width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:12px">
            <i class="fas ${roleStyle.icon}"></i>
          </div>
          <h2 style="margin:0;font-size:24px;font-weight:800;color:#1f2937">${displayName}</h2>
          <span style="background:${roleStyle.bg};color:${roleStyle.color};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;margin-top:8px">${memberProfile.role || 'Member'}</span>
        </div>
        <div style="text-align:left;padding:16px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb">
          <div style="margin-bottom:10px"><strong>Email:</strong> ${memberProfile.email || 'N/A'}</div>
          <div style="margin-bottom:10px"><strong>Joined:</strong> ${joinedDate}</div>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#3b82f6',
      denyButtonColor: '#059669',
      cancelButtonColor: '#6b7280',
      confirmButtonText: '<i class="fas fa-bolt" style="margin-right:6px"></i> Quick Overview',
      denyButtonText:    '<i class="fas fa-chart-line" style="margin-right:6px"></i> Full Dashboard',
      cancelButtonText: 'Close',
    }).then(result => {
      if (result.isConfirmed) {
        setViewingCaretaker({
          id: memberProfile.id,
          name: displayName,
          username: memberProfile.username,
          role: memberProfile.role,
          email: memberProfile.email,
          joinedAt: memberProfile.created_at,
        });
      } else if (result.isDenied) {
        localStorage.setItem('swinesync_viewing_mode', memberProfile.id);
        window.location.reload();
      }
    });
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 80 }}>
        <div style={{ textAlign: 'center' }}>
          <i className="fas fa-spinner fa-pulse" style={{ fontSize: 36, color: '#059669' }}></i>
          <p style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading farm data…</p>
        </div>
      </div>
    );
  }

  // ── Owner: No farm yet ──────────────────────────────────────────
  if (isOwner && !hasFarm) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #059669 50%, #0d9488 100%)',
          borderRadius: 24, padding: '48px 40px 40px',
          textAlign: 'center', marginBottom: 20,
          boxShadow: '0 12px 40px rgba(5,150,105,0.3)',
        }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <i className="fas fa-tractor" style={{ fontSize: 34, color: 'white' }}></i>
          </div>
          <h2 style={{ color: 'white', fontWeight: 900, fontSize: 26, margin: '0 0 8px' }}>Create Your Farm</h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: '0 0 32px', lineHeight: 1.6 }}>
            As a farm owner, you need to create your farm first. After that, you can generate an invite code to add caretakers.
          </p>
          <button onClick={createFarm} disabled={isCreatingFarm || !online}
            style={{
              background: (isCreatingFarm || !online) ? 'rgba(255,255,255,0.3)' : 'white',
              color: (isCreatingFarm || !online) ? 'rgba(255,255,255,0.6)' : '#059669',
              border: 'none', borderRadius: 14, padding: '14px 40px', fontWeight: 800,
              cursor: (isCreatingFarm || !online) ? 'not-allowed' : 'pointer',
              fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 10,
            }}>
            <i className={`fas ${isCreatingFarm ? 'fa-spinner fa-spin' : 'fa-plus-circle'}`}></i>
            {isCreatingFarm ? 'Creating…' : 'Create Farm'}
          </button>
          {!online && (
            <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 16px', fontSize: 13, color: '#fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <i className="fas fa-wifi"></i> Requires internet connection
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Caretaker: No farm yet ─────────────────────────────────────
  if (canJoin && !hasJoinedFarm) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #059669 50%, #0d9488 100%)',
          borderRadius: 24, padding: '48px 40px 40px', textAlign: 'center', marginBottom: 20,
          boxShadow: '0 12px 40px rgba(5,150,105,0.3)', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <i className="fas fa-tractor" style={{ fontSize: 34, color: 'white' }}></i>
          </div>
          <h2 style={{ color: 'white', fontWeight: 900, fontSize: 26, margin: '0 0 8px' }}>Join Your Farm</h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: '0 0 32px', lineHeight: 1.6 }}>
            Enter the 8‑character invite code your farm owner shared with you.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <input
              id="farm-invite-code-input"
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={8}
              placeholder="e.g. AB3D7XYZ"
              autoFocus
              style={{
                width: '100%', maxWidth: 340, padding: '16px 20px',
                fontSize: 30, fontWeight: 900, letterSpacing: 12, fontFamily: 'monospace',
                border: '2px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.95)',
                borderRadius: 14, textAlign: 'center', textTransform: 'uppercase',
                outline: 'none', color: '#065f46', boxSizing: 'border-box',
              }}
              onKeyDown={e => { if (e.key === 'Enter') joinFarm(); }}
            />
            <button
              id="farm-invite-join-btn"
              onClick={joinFarm}
              disabled={joining || !online || joinCode.length < 6}
              style={{
                background: (joining || !online || joinCode.length < 6) ? 'rgba(255,255,255,0.3)' : 'white',
                color: (joining || !online || joinCode.length < 6) ? 'rgba(255,255,255,0.6)' : '#059669',
                border: 'none', borderRadius: 14, padding: '14px 40px', fontWeight: 800,
                cursor: (joining || !online || joinCode.length < 6) ? 'not-allowed' : 'pointer',
                fontSize: 16, display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <i className={`fas ${joining ? 'fa-spinner fa-spin' : 'fa-sign-in-alt'}`}></i>
              {joining ? 'Joining…' : 'Join Farm'}
            </button>
          </div>
        </div>
        <div style={{ background: 'white', borderRadius: 16, padding: 22, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb' }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-question-circle" style={{ color: '#059669' }}></i>
            Don't have a code yet?
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, color: '#6b7280', fontSize: 13, lineHeight: 2 }}>
            <li>Ask your farm owner to open the <strong>Farm Access</strong> module.</li>
            <li>They click <strong>Generate Invite Code</strong> and share it with you.</li>
            <li>Enter the 8‑character code in the box above.</li>
            <li>You'll be added to the farm immediately. 🐷</li>
          </ol>
        </div>
      </div>
    );
  }

  // ── Owner with farm OR Caretaker with farm ──────────────────────
  const farmName = farm?.name || (isOwner ? 'My Farm' : 'Your Farm');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Farm Access Card */}
      <div style={{
        background: 'white', borderRadius: '16px', padding: '24px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb',
        borderLeft: '6px solid #3b82f6', width: '100%', maxWidth: '400px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <i className="fas fa-user-friends" style={{ color: '#3b82f6', fontSize: '20px' }}></i>
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: '18px', color: '#111827' }}>Farm Access & Team</h3>
        </div>

        {isOwner && (
          <>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
              Share this code with your caretakers to join your farm:
            </p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                flex: 1, background: '#eff6ff', border: '1px dashed #60a5fa',
                borderRadius: '8px', padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px',
              }}>
                {farm?.invite_code ? (
                  <span style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb', letterSpacing: '4px', fontFamily: 'monospace' }}>
                    {farm.invite_code}
                  </span>
                ) : (
                  <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>No code yet</span>
                )}
              </div>
              {farm?.invite_code ? (
                <button onClick={handleCopy} title="Copy Code"
                  style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16 }}>
                  <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                </button>
              ) : (
                <button onClick={generateCode} disabled={!online || generating} title="Generate invite code"
                  style={{ background: (!online || generating) ? '#9ca3af' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (!online || generating) ? 'not-allowed' : 'pointer', fontSize: 16 }}>
                  <i className={`fas ${generating ? 'fa-spinner fa-spin' : 'fa-magic'}`}></i>
                </button>
              )}
            </div>
            {farm?.invite_code && (
              <button onClick={revokeCode} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', marginBottom: '16px', display: 'block' }}>
                Revoke Code
              </button>
            )}
            <div style={{ height: '1px', background: '#e5e7eb', marginBottom: '20px' }}></div>
          </>
        )}

        {!isOwner && (
          <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
            You are a member of <strong>{farmName}</strong>.
          </p>
        )}

        {!isOwner && (
          <>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
              Need to join a different farm? Enter the access code provided by the owner.
            </p>
            {showJoinInput ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={8} placeholder="Code"
                  style={{ flex: 1, padding: '10px 12px', fontSize: 16, fontWeight: 700, fontFamily: 'monospace', border: '2px solid #3b82f6', borderRadius: '8px', outline: 'none', color: '#1f2937' }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') joinFarm(); }}
                />
                <button onClick={() => joinFarm()} disabled={joining || joinCode.length < 6}
                  style={{ background: (joining || joinCode.length < 6) ? '#9ca3af' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '0 16px', fontWeight: 700, cursor: (joining || joinCode.length < 6) ? 'not-allowed' : 'pointer' }}>
                  {joining ? <i className="fas fa-spinner fa-spin"></i> : 'Join'}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowJoinInput(true)}
                style={{ width: '100%', background: 'white', color: '#3b82f6', border: '2px solid #3b82f6', borderRadius: '8px', padding: '10px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <i className="fas fa-sign-in-alt"></i> Join Another Farm
              </button>
            )}
          </>
        )}
      </div>

      {/* Members List */}
      {members.length > 0 && (
        <div style={{ background: 'white', borderRadius: 20, padding: 28, boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 18px', fontWeight: 800, fontSize: 18, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-users" style={{ color: '#059669' }}></i>
            {farmName} — Members
            <span style={{ background: 'linear-gradient(135deg,#d1fae5,#a7f3d0)', color: '#065f46', borderRadius: 999, padding: '2px 14px', fontSize: 13, fontWeight: 700, marginLeft: 4 }}>
              {members.length}
            </span>
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.map(memberProfile => {
              const roleKey = (memberProfile?.role || 'member').toLowerCase();
              const roleStyle = getRoleStyle(roleKey);
              const isCurrentUser = memberProfile.id === profile?.id;
              const displayName = memberProfile?.username || memberProfile?.full_name || memberProfile?.email?.split('@')[0] || 'Unknown User';
              const displayEmail = memberProfile?.email || `User …${(memberProfile.id || '').slice(-6)}`;
              const clickable = isOwner;

              return (
                <div
                  key={memberProfile.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px',
                    background: isCurrentUser ? '#f0fdf4' : '#f9fafb',
                    borderRadius: 14,
                    border: isCurrentUser ? '1.5px solid #6ee7b7' : '1px solid #e5e7eb',
                    transition: 'box-shadow 0.2s, transform 0.15s',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)';
                    if (clickable) e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onClick={() => clickable && handleMemberClick(memberProfile)}
                >
                  <div style={{
                    background: roleStyle.bg, borderRadius: '50%',
                    width: 44, height: 44, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <i className={`fas ${roleStyle.icon}`} style={{ color: roleStyle.color, fontSize: 17 }}></i>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: isOwner ? '#059669' : '#1f2937', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                      </span>
                      {isCurrentUser && (
                        <span style={{ fontSize: 11, color: '#059669', fontWeight: 600, background: '#d1fae5', borderRadius: 999, padding: '1px 8px', flexShrink: 0 }}>
                          You
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayEmail}
                    </div>
                  </div>

                  <span style={{
                    background: roleStyle.bg, color: roleStyle.color,
                    borderRadius: 999, padding: '4px 14px',
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {memberProfile?.role || 'Member'}
                  </span>

                  {isOwner && !isCurrentUser && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeMember(memberProfile.id, displayName); }}
                      title="Remove from farm"
                      style={{
                        background: '#fee2e2', border: 'none', borderRadius: 8,
                        padding: '8px 12px', color: '#ef4444', cursor: 'pointer', fontSize: 14, flexShrink: 0,
                      }}>
                      <i className="fas fa-user-minus"></i>
                    </button>
                  )}

                  {isOwner && !isCurrentUser && (
                    <i className="fas fa-chevron-right" style={{ color: '#d1d5db', fontSize: 12, flexShrink: 0 }}></i>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {members.length === 0 && (
        <div style={{ background: 'white', borderRadius: 20, padding: 40, textAlign: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb' }}>
          <i className="fas fa-users-slash" style={{ fontSize: 40, color: '#d1d5db', marginBottom: 14 }}></i>
          <h4 style={{ color: '#374151', fontWeight: 700, margin: '0 0 6px' }}>No Members Yet</h4>
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            {isOwner
              ? 'Generate an invite code above and share it with your caretakers.'
              : 'Once you join a farm, its members will appear here.'}
          </p>
        </div>
      )}

      {viewingCaretaker && (
        <CaretakerDashboardModal
          caretaker={viewingCaretaker}
          farmName={farmName}
          onClose={() => setViewingCaretaker(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Caretaker Dashboard Modal — shows real personal contribution + farm context
// ─────────────────────────────────────────────────────────────────────────────
function CaretakerDashboardModal({ caretaker, farmName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [caretaker?.id]);

  async function loadData() {
    if (!caretaker?.id) return;
    setLoading(true);
    try {
      const actorName = caretaker.username;
      const [notifications, farmPigs, inventory, healthRecords, growthRecords, feedLogs] = await Promise.all([
        dataAPI.notifications.getAll().catch(() => []),
        dataAPI.pigs.getAll().catch(() => []),
        dataAPI.inventory.getAll().catch(() => []),
        dataAPI.health_records.getAll().catch(() => []),
        dataAPI.growth_records.getAll().catch(() => []),
        dataAPI.feeding_logs.getAll().catch(() => []),
      ]);

      const myNotifs = actorName ? (notifications || []).filter(n => n.actor_name === actorName) : [];
      const activityAllTime = { pig: 0, feed: 0, health: 0, growth: 0, breeding: 0 };
      const monthStartISO = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      let thisMonthActions = 0;

      myNotifs.forEach(n => {
        const map = NOTIF_CATEGORY[n.type];
        if (!map) return;
        activityAllTime[map.key] += 1;
        if (n.created_at && n.created_at >= monthStartISO) thisMonthActions += 1;
      });

      const recent = [...myNotifs]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 12);

      setData({
        actorName,
        totalActions: myNotifs.length,
        thisMonthActions,
        activityAllTime,
        recent,
        activePigs: (farmPigs || []).filter(p => p.status === 'active').length,
        feedStock: inventory?.[0]?.feed_stock_kg || 0,
        healthRecordsCount: (healthRecords || []).length,
        growthRecordsCount: (growthRecords || []).length,
        feedLogsCount: (feedLogs || []).length,
      });
    } catch (err) {
      console.error('CaretakerDashboardModal error:', err);
    }
    setLoading(false);
  }

  function formatWhen(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const statCard = { background: '#f9fafb', borderRadius: 16, padding: '16px 14px', textAlign: 'center', border: '1px solid #e5e7eb' };
  const CATEGORIES = [
    { key: 'feed',     label: 'Feeding',  color: '#10b981', icon: 'fa-utensils' },
    { key: 'health',   label: 'Health',   color: '#ef4444', icon: 'fa-heartbeat' },
    { key: 'growth',   label: 'Growth',   color: '#3b82f6', icon: 'fa-chart-line' },
    { key: 'breeding', label: 'Breeding', color: '#ec4899', icon: 'fa-heart' },
    { key: 'pig',      label: 'Pig Mgmt', color: '#8b5cf6', icon: 'fa-piggy-bank' },
  ];
  const maxCat = data ? Math.max(...CATEGORIES.map(c => data.activityAllTime[c.key] || 0), 1) : 1;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
        <div style={{ background: 'linear-gradient(135deg,#0f766e,#059669)', borderRadius: '24px 24px 0 0', padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10, color: 'white', cursor: 'pointer', padding: '8px 16px', fontSize: 14, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
              <i className="fas fa-arrow-left"></i> Back
            </button>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-user-cog" style={{ color: 'white', fontSize: 20 }}></i>
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Caretaker Activity</div>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 800 }}>{caretaker.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{caretaker.role || 'Farm Caretaker'} · {farmName}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10, color: 'white', width: 36, height: 36, cursor: 'pointer' }}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div style={{ padding: 28 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <i className="fas fa-spinner fa-pulse" style={{ fontSize: 32, color: '#059669' }}></i>
              <p style={{ marginTop: 12, color: '#6b7280' }}>Loading…</p>
            </div>
          ) : !data ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#6b7280' }}>
              <i className="fas fa-exclamation-circle" style={{ fontSize: 32, marginBottom: 12, color: '#f59e0b' }}></i>
              <p>No data available.</p>
            </div>
          ) : (
            <>
              <h4 style={{ margin: '0 0 12px 0', fontWeight: 800, color: '#1f2937', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="fas fa-user-check" style={{ color: '#059669' }}></i> Personal Contribution
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 24 }}>
                <div style={statCard}>
                  <i className="fas fa-bolt" style={{ fontSize: 22, color: '#f59e0b', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.totalActions}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Total Actions</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-calendar-day" style={{ fontSize: 22, color: '#3b82f6', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.thisMonthActions}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>This Month</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-utensils" style={{ fontSize: 22, color: '#10b981', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.activityAllTime.feed}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Feed Logs</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-heartbeat" style={{ fontSize: 22, color: '#ef4444', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.activityAllTime.health}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Health</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-chart-line" style={{ fontSize: 22, color: '#3b82f6', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.activityAllTime.growth}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Growth</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-heart" style={{ fontSize: 22, color: '#ec4899', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{data.activityAllTime.breeding}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Breeding</div>
                </div>
              </div>

              <h4 style={{ margin: '0 0 12px 0', fontWeight: 800, color: '#1f2937', fontSize: 15 }}>Activity Breakdown</h4>
              <div style={{ background: '#f9fafb', borderRadius: 14, padding: 18, border: '1px solid #e5e7eb', marginBottom: 24 }}>
                {data.totalActions === 0 ? (
                  <p style={{ margin: 0, textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: '12px 0' }}>
                    No recorded activity for this caretaker yet.
                  </p>
                ) : CATEGORIES.map(cat => {
                  const val = data.activityAllTime[cat.key] || 0;
                  const pct = Math.round((val / maxCat) * 100);
                  return (
                    <div key={cat.key} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                          <i className={`fas ${cat.icon}`} style={{ color: cat.color, width: 14 }}></i>{cat.label}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: cat.color }}>{val}</span>
                      </div>
                      <div style={{ background: '#e5e7eb', height: 8, borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: cat.color, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <h4 style={{ margin: '0 0 12px 0', fontWeight: 800, color: '#1f2937', fontSize: 15 }}>Recent Activity</h4>
              {data.recent.length === 0 ? (
                <div style={{ background: '#f9fafb', borderRadius: 14, padding: 32, border: '1px dashed #d1d5db', textAlign: 'center', color: '#9ca3af' }}>
                  <i className="fas fa-inbox" style={{ fontSize: 32, display: 'block', marginBottom: 8 }}></i>
                  <p style={{ margin: 0, fontSize: 14 }}>Nothing logged yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {data.recent.map(n => {
                    const cat = NOTIF_CATEGORY[n.type];
                    const color = cat?.color || '#6b7280';
                    const icon = cat?.icon || 'fa-bell';
                    return (
                      <div key={n.id} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'white', border: '1px solid #e5e7eb', borderLeft: `4px solid ${color}`, borderRadius: 12 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <i className={`fas ${icon}`} style={{ color, fontSize: 13 }}></i>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 13 }}>{NOTIF_TITLE[n.type] || 'Activity'}</div>
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>{formatWhen(n.created_at)}</div>
                          </div>
                          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 4, lineHeight: 1.45, wordBreak: 'break-word' }}>{n.message}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <h4 style={{ margin: '0 0 12px 0', fontWeight: 800, color: '#1f2937', fontSize: 15 }}>Shared Farm Context</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 20 }}>
                <div style={statCard}>
                  <i className="fas fa-piggy-bank" style={{ fontSize: 22, color: '#10b981', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{data.activePigs}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Active Pigs</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-warehouse" style={{ fontSize: 22, color: '#f59e0b', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{data.feedStock} kg</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Feed Stock</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-heartbeat" style={{ fontSize: 22, color: '#ef4444', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{data.healthRecordsCount}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Farm Health Recs</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-utensils" style={{ fontSize: 22, color: '#10b981', marginBottom: 6 }}></i>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{data.feedLogsCount}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Farm Feed Logs</div>
                </div>
              </div>

              <div style={{ background: '#ecfdf5', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="fas fa-info-circle" style={{ color: '#059669', flexShrink: 0 }}></i>
                <span style={{ fontSize: 13, color: '#065f46', lineHeight: 1.5 }}>
                  Since {caretaker.name} is a member of <strong>{farmName}</strong>, they share herd and inventory data.
                  The stats above show their <strong>personal contribution</strong> alongside shared farm context.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}