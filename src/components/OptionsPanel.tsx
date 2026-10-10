import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import type { Prefs } from '../lib/prefs';
import { theme } from '../theme';

type Props = {
  visible: boolean;
  prefs: Prefs;
  onChange: (patch: Partial<Prefs>) => void;
  onShare: () => void;
  onClose: () => void;
};

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.off, true: theme.colors.redDim }}
        thumbColor={value ? theme.colors.redBright : theme.colors.textDim}
      />
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [txt, setTxt] = useState(String(value));
  const commit = () => {
    const n = parseFloat(txt.replace(',', '.'));
    onChange(Number.isFinite(n) ? n : 0);
  };
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={txt}
        onChangeText={setTxt}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="numeric"
        returnKeyType="done"
        placeholderTextColor={theme.colors.textDim}
      />
    </View>
  );
}

export function OptionsPanel({ visible, prefs, onChange, onShare, onClose }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <Text style={styles.title}>{t('options.title')}</Text>
        <Toggle
          label={t('options.saveJpegs')}
          value={prefs.saveJpegs}
          onValueChange={(v) => onChange({ saveJpegs: v })}
        />
        <Toggle
          label={t('options.saveTraces')}
          value={prefs.saveTraces}
          onValueChange={(v) => onChange({ saveTraces: v })}
        />
        <Toggle
          label={t('options.nightMode')}
          value={prefs.nightMode}
          onValueChange={(v) => onChange({ nightMode: v })}
        />
        <Toggle
          label={t('options.gtiReticle')}
          value={prefs.gtiReticle}
          onValueChange={(v) => onChange({ gtiReticle: v })}
        />
        <Toggle
          label={t('options.afLock')}
          value={prefs.afLock}
          onValueChange={(v) => onChange({ afLock: v })}
        />
        <Text style={styles.section}>{t('options.advanced')}</Text>
        <NumberField
          label={t('options.pxPerDeg')}
          value={prefs.pxPerDeg}
          onChange={(v) => onChange({ pxPerDeg: v })}
        />
        <NumberField
          label={t('options.tolDeg')}
          value={prefs.tolDeg}
          onChange={(v) => onChange({ tolDeg: v })}
        />
        <NumberField
          label={t('options.calibFrames')}
          value={prefs.calibFrames}
          onChange={(v) => onChange({ calibFrames: Math.max(1, Math.round(v)) })}
        />
        <Text style={styles.hint}>{t('options.hint')}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={onShare}>
            <Text style={styles.btnText}>{t('options.share')}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>{t('options.close')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  panel: {
    backgroundColor: theme.colors.panel,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.space(2),
    width: '86%',
    gap: theme.space(1),
  },
  title: {
    color: theme.colors.redBright,
    fontFamily: theme.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: theme.space(0.5),
  },
  section: {
    color: theme.colors.redDim,
    fontFamily: theme.mono,
    fontSize: 11,
    letterSpacing: 1,
    marginTop: theme.space(0.5),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(1),
  },
  label: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    flexShrink: 1,
  },
  input: {
    color: theme.colors.redBright,
    fontFamily: theme.mono,
    fontSize: 12,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: theme.space(1),
    minWidth: 72,
    textAlign: 'right',
  },
  hint: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 11,
    marginTop: theme.space(0.5),
  },
  actions: {
    flexDirection: 'row',
    gap: theme.space(1),
    marginTop: theme.space(1),
  },
  btn: {
    flex: 1,
    borderColor: theme.colors.redDim,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: theme.space(1),
    alignItems: 'center',
  },
  btnText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    fontWeight: '700',
  },
});
