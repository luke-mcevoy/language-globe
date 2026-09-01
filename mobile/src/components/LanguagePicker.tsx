import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LearningLanguage } from '../types';
import { languageLabel } from '../lib/languages';

interface LanguagePickerProps {
  language: string;
  languages: LearningLanguage[];
  onChange: (language: string) => void;
}

export function LanguagePicker({ language, languages, onChange }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const label = languageLabel(language, languages);

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Language to learn, ${label}`}
      >
        <Text style={styles.triggerText}>{label}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.title}>Language to learn</Text>
            <ScrollView style={styles.list}>
              {languages.map((item) => {
                const selected = item.id === language;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.row, selected && styles.rowOn]}
                    onPress={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.rowName, selected && styles.rowNameOn]}>{item.nativeName}</Text>
                    <Text style={styles.rowEnglish}>{item.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  triggerText: {
    color: '#eaf2ff',
    fontWeight: '800',
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(6, 10, 21, 0.62)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    maxHeight: '72%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(9, 14, 29, 0.96)',
    paddingVertical: 14,
  },
  title: {
    color: '#f7fbff',
    fontWeight: '800',
    fontSize: 16,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 8,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowOn: {
    backgroundColor: 'rgba(84,230,195,0.14)',
  },
  rowName: {
    color: '#eaf2ff',
    fontWeight: '700',
    fontSize: 16,
  },
  rowNameOn: {
    color: '#54e6c3',
  },
  rowEnglish: {
    color: '#9ba8c3',
    fontSize: 13,
  },
});
