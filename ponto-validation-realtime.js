/**
 * validation-realtime.js - Validação em tempo real de formulários
 * Melhora UX com feedback imediato
 */

const RealtimeValidation = {
    validators: {},
    activeFields: new Map(),

    /**
     * Inicializa validação em tempo real
     */
    init() {
        this.setupDefaultValidators();
    },

    /**
     * Configura validadores padrão
     */
    setupDefaultValidators() {
        // Validador de data
        this.validators.date = {
            validate: (value) => {
                if (!value) return { valid: true };
                const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value));
                return {
                    valid,
                    message: valid ? '' : 'Data inválida (use formato YYYY-MM-DD)'
                };
            },
            icon: (typeof svgIcon === 'function') ? svgIcon('calendar', 'Calendário') : '📅'
        };

        // Validador de hora
        this.validators.time = {
            validate: (value) => {
                if (!value) return { valid: true };
                const match = /^(\d{1,2}):(\d{2})$/.test(value);
                if (!match) return { valid: false, message: 'Hora inválida (use formato HH:MM)' };
                
                const [h, m] = value.split(':').map(Number);
                const valid = h >= 0 && h < 24 && m >= 0 && m < 60;
                return {
                    valid,
                    message: valid ? '' : 'Hora deve estar entre 00:00 e 23:59'
                };
            },
            icon: (typeof svgIcon === 'function') ? svgIcon('timer', 'Horário') : '⏰'
        };

        // Validador de required
        this.validators.required = {
            validate: (value) => {
                const valid = value && value.trim().length > 0;
                return {
                    valid,
                    message: valid ? '' : 'Campo obrigatório'
                };
            },
            icon: (typeof svgIcon === 'function') ? svgIcon('help', 'Aviso') : '⚠️'
        };

        // Validador de email
        this.validators.email = {
            validate: (value) => {
                if (!value) return { valid: true };
                const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
                return {
                    valid,
                    message: valid ? '' : 'E-mail inválido'
                };
            },
            icon: (typeof svgIcon === 'function') ? svgIcon('help', 'E-mail') : '📧'
        };

        // Validador numérico
        this.validators.number = {
            validate: (value, min, max) => {
                if (!value) return { valid: true };
                const num = Number(value);
                if (isNaN(num)) return { valid: false, message: 'Deve ser um número' };
                
                if (min !== undefined && num < min) {
                    return { valid: false, message: `Mínimo: ${min}` };
                }
                if (max !== undefined && num > max) {
                    return { valid: false, message: `Máximo: ${max}` };
                }
                
                return { valid: true };
            },
            icon: (typeof svgIcon === 'function') ? svgIcon('help', 'Número') : '🔢'
        };
    },

    /**
     * Ativa validação para um campo
     */
    enableForField(fieldId, validatorNames, options = {}) {
        const field = document.getElementById(fieldId);
        if (!field) return;

        const config = {
            validators: Array.isArray(validatorNames) ? validatorNames : [validatorNames],
            options: options,
            debounceTime: options.debounceTime || 500
        };

        this.activeFields.set(fieldId, config);

        // Criar container de feedback (aria-friendly)
        let feedback = field.parentElement.querySelector('.validation-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'validation-feedback';
            // ARIA: make it a polite live region for assistive tech
            feedback.setAttribute('role', 'status');
            feedback.setAttribute('aria-live', 'polite');
            feedback.id = `validation-feedback-${fieldId}`;
            field.parentElement.appendChild(feedback);
        } else if (!feedback.id) {
            feedback.id = `validation-feedback-${fieldId}`;
        }
        // Link field and feedback for accessibility
        field.setAttribute('aria-describedby', feedback.id);
        // Ensure form-group exists and has proper class container
        const fg = field.closest && field.closest('.form-group');
        if (fg && !fg.classList.contains('has-validation')) fg.classList.add('has-validation');

        // Event listeners
        const debouncedValidate = Utils.debounce(() => {
            this.validateField(fieldId);
        }, config.debounceTime);

        field.addEventListener('input', debouncedValidate);
        field.addEventListener('blur', () => this.validateField(fieldId));

        // Validação inicial
        if (field.value) {
            this.validateField(fieldId);
        }
    },

    /**
     * Valida um campo específico
     */
    validateField(fieldId) {
        const field = document.getElementById(fieldId);
        const config = this.activeFields.get(fieldId);
        if (!field || !config) return true;

        const value = field.value;
        const feedback = field.parentElement.querySelector('.validation-feedback');
        
        let allValid = true;
        const messages = [];

        // Executar todos os validadores
        for (const validatorName of config.validators) {
            const validator = this.validators[validatorName];
            if (!validator) continue;

            const result = validator.validate(value, config.options.min, config.options.max);
            if (!result.valid) {
                allValid = false;
                messages.push({ icon: validator.icon, text: result.message });
            }
        }

        // Atualizar UI
        field.classList.remove('field-valid', 'field-invalid');
        field.removeAttribute('aria-invalid');
        const formGroup = field.closest && field.closest('.form-group');
        if (formGroup) { formGroup.classList.remove('invalid','valid'); }
        
        if (value) { // Só mostrar validação se houver valor
            if (allValid) {
                field.classList.add('field-valid');
                field.setAttribute('aria-invalid', 'false');
                if (formGroup) formGroup.classList.add('valid');
                if (feedback) {
                    feedback.innerHTML = '<span class="validation-success">✓ Válido</span>';
                    feedback.className = 'validation-feedback success';
                }
            } else {
                field.classList.add('field-invalid');
                field.setAttribute('aria-invalid', 'true');
                if (formGroup) formGroup.classList.add('invalid');
                if (feedback) {
                    // Wrap icons/markers in aria-hidden so screen readers read only the message
                    feedback.innerHTML = messages.map(m => 
                        `<span class="validation-error"><span class="vicon" aria-hidden="true">${m.icon}</span> ${m.text}</span>`
                    ).join('');
                    feedback.className = 'validation-feedback error';
                }
            }
        } else if (feedback) {
            feedback.innerHTML = '';
            feedback.className = 'validation-feedback';
            field.removeAttribute('aria-describedby');
            if (formGroup) { formGroup.classList.remove('invalid','valid'); }
        }

        return allValid;
    },

    /**
     * Valida todos os campos ativos
     */
    validateAll() {
        let allValid = true;
        
        for (const fieldId of this.activeFields.keys()) {
            const valid = this.validateField(fieldId);
            if (!valid) allValid = false;
        }

        return allValid;
    },

    /**
     * Remove validação de um campo
     */
    disableForField(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return;

        this.activeFields.delete(fieldId);
        field.classList.remove('field-valid', 'field-invalid');
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
        const formGroup = field.closest && field.closest('.form-group');
        if (formGroup) { formGroup.classList.remove('has-validation','invalid','valid'); }
        
        const feedback = field.parentElement.querySelector('.validation-feedback');
        if (feedback) {
            feedback.remove();
        }
    },

    /**
     * Adiciona validador customizado
     */
    addValidator(name, validateFn, icon = '⚠️') {
        this.validators[name] = {
            validate: validateFn,
            icon
        };
    },

    /**
     * Validação comparativa (ex: saída > entrada)
     */
    validateComparison(field1Id, field2Id, operator, message) {
        const field1 = document.getElementById(field1Id);
        const field2 = document.getElementById(field2Id);
        if (!field1 || !field2) return true;

        const val1 = field1.value;
        const val2 = field2.value;

        if (!val1 || !val2) return true;

        let valid = false;
        switch (operator) {
            case '>':
                valid = val1 > val2;
                break;
            case '<':
                valid = val1 < val2;
                break;
            case '>=':
                valid = val1 >= val2;
                break;
            case '<=':
                valid = val1 <= val2;
                break;
            case '==':
                valid = val1 == val2;
                break;
        }

        if (!valid) {
            const feedback = field2.parentElement.querySelector('.validation-feedback');
            if (feedback) {
                feedback.innerHTML = `<span class="validation-error"><span class="vicon" aria-hidden="true">⚠️</span> ${message}</span>`;
                feedback.className = 'validation-feedback error';
                field2.setAttribute('aria-describedby', feedback.id || `validation-feedback-${field2.id}`);
            }
            field2.classList.add('field-invalid');
            field2.setAttribute('aria-invalid', 'true');
        }

        return valid;
    }
};

// Inicializar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => RealtimeValidation.init());
} else {
    RealtimeValidation.init();
}
