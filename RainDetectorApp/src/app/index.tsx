
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  fetchLatestRain,
  getDefaultApiUrl,
  RainApiResponse,
} from '../services/rainApi';
import { alarmService } from '../services/alarmService';

export default function RainDetectorScreen() {
  const insets = useSafeAreaInsets();

  const [apiUrl, setApiUrl] = useState<string>(() => getDefaultApiUrl());
  const [reading, setReading] = useState<RainApiResponse | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [inputUrl, setInputUrl] = useState<string>(apiUrl);
  const [lastCheckTime, setLastCheckTime] = useState<string>('Never');
  const [isMutedByUser, setIsMutedByUser] = useState<boolean>(false);

  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const sirenAnim = useMemo(() => new Animated.Value(1), []);

  // Pulse animation for live monitoring indicator
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Siren animation for Heavy Rain
  useEffect(() => {
    const siren = Animated.loop(
      Animated.sequence([
        Animated.timing(sirenAnim, {
          toValue: 0.4,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(sirenAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ])
    );
    siren.start();
    return () => siren.stop();
  }, [sirenAnim]);

  // Format updated timestamp into readable time
  const formatTime = (isoString?: string): string => {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '--:--';
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '--:--';
    }
  };

  // Polling loop every 2.5 seconds
  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      try {
        const data = await fetchLatestRain(apiUrl);
        if (isMounted) {
          setReading(data);
          setIsConnected(true);
          setLastCheckTime(
            new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          );
          if (data.level !== 'HEAVY') {
            setIsMutedByUser(false);
          }
        }
      } catch {
        if (isMounted) {
          setIsConnected(false);
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [apiUrl]);

  // Handle Phone Ringing Alarm on HEAVY rain
  useEffect(() => {
    if (reading?.level === 'HEAVY' && !isMutedByUser) {
      alarmService.startRinging();
    } else {
      alarmService.stopRinging();
    }

    return () => {
      alarmService.stopRinging();
    };
  }, [reading?.level, isMutedByUser]);

  // Pull to refresh handler
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await fetchLatestRain(apiUrl);
      setReading(data);
      setIsConnected(true);
      setLastCheckTime(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch {
      setIsConnected(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [apiUrl]);

  // Save new URL from settings modal
  const handleSaveUrl = () => {
    const clean = inputUrl.trim();
    if (clean) {
      setApiUrl(clean);
      setReading(null);
      setIsConnected(null);
    }
    setShowSettings(false);
  };

  // Weather level presentation mappings
  const getLevelDisplay = () => {
    if (isConnected === false) {
      return {
        title: 'SERVER DISCONNECTED',
        color: '#EF4444',
        sub: 'Unable to reach backend API',
        intensityText: 'Disconnected',
      };
    }

    if (!reading || reading.level === undefined) {
      return {
        title: reading?.online === false ? 'SENSOR OFFLINE' : 'WAITING FOR DATA',
        color: '#9CA3AF',
        sub: 'No sensor reading received yet',
        intensityText: 'No Data',
      };
    }

    switch (reading.level) {
      case 'HEAVY':
        return {
          title: 'HEAVY RAIN',
          color: '#EF4444',
          sub: 'Heavy precipitation detected by sensor',
          intensityText: 'Heavy Rain',
        };
      case 'LIGHT':
        return {
          title: 'LIGHT RAIN',
          color: '#00A3FF',
          sub: 'Light rainfall detected by sensor',
          intensityText: 'Light Rain',
        };
      case 'STOPPED':
        return {
          title: 'RAIN STOPPED',
          color: '#FBBF24',
          sub: 'Sensor surface is drying',
          intensityText: 'Drying Off',
        };
      case 'DRY':
      default:
        return {
          title: 'NORMAL / DRY',
          color: '#00E676',
          sub: 'No rain detected by sensor',
          intensityText: 'Clear / Dry',
        };
    }
  };

  const levelInfo = getLevelDisplay();
  const intensityValue = reading?.intensity ?? 0;
  const progressPercent = Math.min(100, Math.max(0, intensityValue));

  const isSensorOnline = Boolean(reading?.online);
  const updatedDisplay = reading?.updated
    ? formatTime(reading.updated)
    : lastCheckTime;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#00A3FF"
            colors={['#00A3FF']}
          />
        }
      >
        {/* App Title & Server Settings Shortcut */}
        <View style={styles.topHeader}>
          <View>
            <Text style={styles.headerTitle}>Rain Detector</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => {
                setInputUrl(apiUrl);
                setShowSettings(true);
              }}
              activeOpacity={0.7}
            >
              <Feather name="settings" size={19} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ================= LIGHT RAIN WARNING BANNER ================= */}
        {reading?.level === 'LIGHT' && (
          <View style={styles.lightWarningBanner}>
            <Feather name="alert-triangle" size={24} color="#FBBF24" />
            <View style={styles.alertContent}>
              <Text style={styles.lightWarningTitle}>
                ⚠️ WARNING: LIGHT RAIN DETECTED!
              </Text>
              <Text style={styles.lightWarningSub}>
                Precipitation has begun. Check windows and bring in hanging clothes.
              </Text>
            </View>
          </View>
        )}

        {/* ================= HEAVY RAIN PHONE RINGING BANNER ================= */}
        {reading?.level === 'HEAVY' && (
          <Animated.View
            style={[styles.heavyAlertBanner, { opacity: sirenAnim }]}
          >
            <View style={styles.heavyAlertHeader}>
              <View style={styles.ringingIconCircle}>
                <Feather name="bell" size={24} color="#FFFFFF" />
              </View>
              <View style={styles.alertContent}>
                <Text style={styles.heavyAlertTitle}>
                  🚨 EMERGENCY: HEAVY RAIN DETECTED!
                </Text>
                <Text style={styles.heavyAlertSub}>
                  {isMutedByUser
                    ? 'Phone ring silenced'
                    : '🔔 PHONE IS RINGING & VIBRATING NOW!'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.silenceButton}
              onPress={() => {
                alarmService.stopRinging();
                setIsMutedByUser(true);
              }}
              activeOpacity={0.8}
            >
              <Feather
                name={isMutedByUser ? 'check-circle' : 'volume-x'}
                size={16}
                color="#FFFFFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.silenceButtonText}>
                {isMutedByUser ? 'Ring Silenced' : 'Silence Phone Ring'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Hero Card: Current Weather Status */}
        <View style={styles.weatherStatusCard}>
          <Text style={styles.weatherCardTitle}>
            Current Weather Status
          </Text>
          <Text style={[styles.weatherStatusValue, { color: levelInfo.color }]}>
            {levelInfo.title}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.weatherCardSubtitle}>{levelInfo.sub}</Text>
        </View>

        {/* 2x2 Grid of Stat Cards */}
        <View style={styles.gridContainer}>
          {/* Row 1 */}
          <View style={styles.gridRow}>
            {/* Card 1: Rain Intensity */}
            <View style={styles.statCard}>
              <View style={styles.iconContainer}>
                <Feather name="droplet" size={24} color="#00A3FF" />
              </View>
              <Text style={styles.statLabel}>Rain Intensity</Text>
              <Text style={styles.statValue}>
                {reading ? `${intensityValue}%` : '--'}
              </Text>
              <Text style={styles.statSubText}>
                {levelInfo.intensityText}
              </Text>
            </View>

            {/* Card 2: Sensor Status */}
            <View style={styles.statCard}>
              <View style={styles.iconContainer}>
                <Feather
                  name="activity"
                  size={24}
                  color={isSensorOnline ? '#00E676' : '#9CA3AF'}
                />
              </View>
              <Text style={styles.statLabel}>Sensor Status</Text>
              <Text
                style={[
                  styles.statValue,
                  { color: isSensorOnline ? '#00E676' : '#9CA3AF' },
                ]}
              >
                {isSensorOnline ? 'Active' : 'Offline'}
              </Text>
              <Text style={styles.statSubText}>
                {isSensorOnline ? 'ESP32 transmitting' : 'No signal in 10s'}
              </Text>
            </View>
          </View>

          {/* Row 2 */}
          <View style={styles.gridRow}>
            {/* Card 3: Last Updated */}
            <View style={styles.statCard}>
              <View style={styles.iconContainer}>
                <Feather name="clock" size={24} color="#F3F4F6" />
              </View>
              <Text style={styles.statLabel}>Last Updated</Text>
              <Text style={styles.statValue}>{updatedDisplay}</Text>
              <Text style={styles.statSubText}>Auto refresh 2.5s</Text>
            </View>

            {/* Card 4: Connection */}
            <View style={styles.statCard}>
              <View style={styles.iconContainer}>
                <Feather
                  name={isConnected ? 'wifi' : 'wifi-off'}
                  size={24}
                  color={isConnected ? '#00E676' : '#EF4444'}
                />
              </View>
              <Text style={styles.statLabel}>Connection</Text>
              <Text
                style={[
                  styles.statValue,
                  { color: isConnected ? '#00E676' : '#EF4444' },
                ]}
              >
                {isConnected ? 'Connected' : 'Offline'}
              </Text>
              <Text style={styles.statSubText}>
                {isConnected ? 'API Responsive' : 'Check backend'}
              </Text>
            </View>
          </View>
        </View>

        {/* Rain Detector Gauge / Reading Card */}
        <View style={styles.gaugeCard}>
          <View style={styles.gaugeHeaderRow}>
            <View>
              <Text style={styles.gaugeTitle}>Rain Detector Gauge</Text>
              <Text style={styles.gaugeSubtitle}>
                Current intensity reading
              </Text>
            </View>
            <Text style={styles.gaugePercentage}>{progressPercent}%</Text>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressPercent}%`,
                  backgroundColor:
                    progressPercent > 60
                      ? '#EF4444'
                      : progressPercent > 20
                      ? '#00A3FF'
                      : '#00E676',
                },
              ]}
            />
          </View>

          {/* Raw Sensor Details */}
          {reading && reading.value !== undefined && (
            <View style={styles.rawReadingRow}>
              <Text style={styles.rawText}>
                Analog Value: <Text style={styles.rawBold}>{reading.value}</Text>
              </Text>
              <Text style={styles.rawText}>
                Delta: <Text style={styles.rawBold}>{reading.delta}</Text>
              </Text>
              <Text style={styles.rawText}>
                Buzzer:{' '}
                <Text style={styles.rawBold}>
                  {reading.muted ? 'Muted' : 'Sound ON'}
                </Text>
              </Text>
            </View>
          )}

          <Text style={styles.disclaimerText}>
            Illustrative intensity indicator computed from ESP32 moisture delta.
          </Text>
        </View>
      </ScrollView>

      {/* Footer pinned at bottom */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <Text style={styles.footerText}>Device: ESP32-S3</Text>
        <View style={styles.footerLiveRow}>
          <Animated.View
            style={[
              styles.pulseDot,
              {
                opacity: pulseAnim,
                backgroundColor: isConnected ? '#00E676' : '#EF4444',
              },
            ]}
          />
          <Text style={styles.footerText}>
            {isConnected ? 'Live monitoring' : 'Standby'}
          </Text>
        </View>
      </View>

      {/* Settings Modal to Configure Backend URL */}
      <Modal
        visible={showSettings}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Backend API Settings</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Feather name="x" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Laravel API Base URL:</Text>
            <TextInput
              style={styles.textInput}
              value={inputUrl}
              onChangeText={setInputUrl}
              placeholder="http://192.168.0.101:8000"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.quickPresetLabel}>Quick Presets:</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setInputUrl('http://192.168.0.101:8000')}
              >
                <Text style={styles.presetChipText}>
                  Wi-Fi (192.168.0.101)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setInputUrl('http://localhost:8000')}
              >
                <Text style={styles.presetChipText}>Localhost:8000</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => setInputUrl('http://10.0.2.2:8000')}
              >
                <Text style={styles.presetChipText}>Android Emulator</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowSettings(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveUrl}
              >
                <Text style={styles.saveButtonText}>Save & Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121316',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E1F24',
    borderWidth: 1,
    borderColor: '#26282E',
  },

  /* LIGHT RAIN WARNING BANNER */
  lightWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderWidth: 1,
    borderColor: '#FBBF24',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  alertContent: {
    flex: 1,
    marginLeft: 12,
  },
  lightWarningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FBBF24',
    letterSpacing: 0.2,
  },
  lightWarningSub: {
    fontSize: 12,
    color: '#E5E7EB',
    marginTop: 2,
    lineHeight: 16,
  },

  /* HEAVY RAIN EMERGENCY RINGING BANNER */
  heavyAlertBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  heavyAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  ringingIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heavyAlertTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.2,
  },
  heavyAlertSub: {
    fontSize: 12,
    color: '#FEE2E2',
    marginTop: 2,
    fontWeight: '600',
  },
  silenceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 10,
  },
  silenceButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  /* Current Weather Status Hero Card */
  weatherStatusCard: {
    backgroundColor: '#1A1B1F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26282E',
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 16,
  },
  weatherCardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#9CA3AF',
    letterSpacing: 0.2,
  },
  weatherStatusValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#00E676',
    marginTop: 8,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#2A2C32',
    marginVertical: 16,
  },
  weatherCardSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '400',
  },

  /* 2x2 Grid of Cards */
  gridContainer: {
    gap: 12,
    marginBottom: 16,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1E1F24',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26282E',
    padding: 16,
    minHeight: 145,
    justifyContent: 'space-between',
  },
  iconContainer: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '400',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  statSubText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },

  /* Rain Detector Gauge Card */
  gaugeCard: {
    backgroundColor: '#1A1B1F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26282E',
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 16,
  },
  gaugeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  gaugeTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  gaugeSubtitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  gaugePercentage: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00A3FF',
  },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2A2C32',
    overflow: 'hidden',
    flexDirection: 'row',
    marginVertical: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: 6,
  },
  rawReadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#26282E',
  },
  rawText: {
    fontSize: 11,
    color: '#8E8E93',
  },
  rawBold: {
    color: '#E5E7EB',
    fontWeight: '600',
  },
  disclaimerText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 10,
    lineHeight: 15,
  },

  /* Footer */
  footer: {
    backgroundColor: '#090A0C',
    borderTopWidth: 1,
    borderTopColor: '#1A1B1F',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  footerText: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '400',
  },
  footerLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1E1F24',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26282E',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#121316',
    borderWidth: 1,
    borderColor: '#2A2C32',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 14,
  },
  quickPresetLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 6,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  presetChip: {
    backgroundColor: '#2A2C32',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  presetChipText: {
    fontSize: 11,
    color: '#E5E7EB',
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  cancelButtonText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  saveButton: {
    backgroundColor: '#00A3FF',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
