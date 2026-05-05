/**
 * calculations.js - Todas as lógicas de cálculo de horas
 * Separação total da lógica de negócio do UI
 */

const Calculations = {
    /**
     * Normaliza data para formato YYYY-MM-DD para comparação
     * Aceita DD/MM/YYYY ou YYYY-MM-DD
     */
    normalizeDateForComparison(dateStr) {
        if (!dateStr) return null;
        
        // Se já está em YYYY-MM-DD, retorna
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return dateStr;
        }
        
        // Se está em DD/MM/YYYY, converte
        const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            const [, day, month, year] = m;
            return `${year}-${month}-${day}`;
        }
        
        return null;
    },

    /**
     * Obtém o evento vigente para uma data específica
     */
    getEventoByData(eventos, dataStr) {
        if (!Array.isArray(eventos) || !dataStr) return null;
        
        const dataNormalizada = this.normalizeDateForComparison(dataStr);
        
        return eventos.find(e =>
            this.normalizeDateForComparison(e.dataInicioEvento) <= dataNormalizada &&
            this.normalizeDateForComparison(e.dataFimEvento) >= dataNormalizada
        ) || null;
    },

    /**
     * Obtém acordo vigente para uma data
     */
    getAcordoByData(acordos, dataStr) {
        if (!Array.isArray(acordos) || !dataStr) return null;

        const dataNormalizada = this.normalizeDateForComparison(dataStr);

        for (const acordo of acordos) {
            if (!Array.isArray(acordo.periodos)) continue;
            
            const periodo = acordo.periodos.find(p =>
                this.normalizeDateForComparison(p.inicio) <= dataNormalizada && 
                this.normalizeDateForComparison(p.fim) >= dataNormalizada
            );
            
            if (periodo) return acordo;
        }
        return null;
    },

    /**
     * Obtém minutos extras válidos para um dia
     */
    getMinutosExtrasForDay(acordo, dataStr) {
        if (!acordo || !Array.isArray(acordo.periodos) || !dataStr) return 0;

        const dataNormalizada = this.normalizeDateForComparison(dataStr);
        
        const periodo = acordo.periodos.find(p =>
            this.normalizeDateForComparison(p.inicio) <= dataNormalizada && 
            this.normalizeDateForComparison(p.fim) >= dataNormalizada
        );

        return periodo ? Number(periodo.minutosExtras || 0) : 0;
    },

    /**
     * Obtém regra de horário vigente
     */
    getRegraHorarioForDay(acordo, dataStr) {
        if (!acordo || !Array.isArray(acordo.regrasHorario) || !dataStr) {
            return this.getDefaultRegra();
        }

        const dataNormalizada = this.normalizeDateForComparison(dataStr);

        return acordo.regrasHorario.find(r =>
            this.normalizeDateForComparison(r.inicio) <= dataNormalizada && 
            this.normalizeDateForComparison(r.fim) >= dataNormalizada
        ) || this.getDefaultRegra();
    },

    /**
     * Regra padrão para dias sem regra específica
     */
    getDefaultRegra() {
        return {
            almocoMin: 60,
            tolAlmoco: 0,
            tolSaida: 0,
            minutosExtras: 0
        };
    },

    /**
     * Calcula horas trabalhadas para um dia com detalhes
     */
    calculateDayDetail(registro, minutosExtrasPeriodo, regra) {
        // Sem registro = sem horas
        if (!registro || !registro.entrada || !registro.saida) {
            return {
                trabalhadas: 0,
                saldo: 0,
                temRegistro: !!registro,
                status: 'sem_registro',
                detalhes: {}
            };
        }

        const entrada = DateUtils.timeToMinutes(registro.entrada);
        const saida = DateUtils.timeToMinutes(registro.saida);
        const saidaAlm = registro.saidaAlmoco ? DateUtils.timeToMinutes(registro.saidaAlmoco) : null;
        const retornoAlm = registro.retornoAlmoco ? DateUtils.timeToMinutes(registro.retornoAlmoco) : null;

        // Validação de entrada/saída
        if (entrada === null || saida === null) {
            return {
                trabalhadas: 0,
                saldo: 0,
                temRegistro: true,
                status: 'erro_hora',
                detalhes: { erro: 'Horários inválidos' }
            };
        }

        // Calcular almoço
        const almocoPadrao = regra.almocoMin || 60;
        const tolAlmoco = regra.tolAlmoco || 5;
        const tolSaida = regra.tolSaida || 5;

        let duracaoAlmoco = almocoPadrao;

        // Se houver horários de almoço registrados
        if (saidaAlm !== null && retornoAlm !== null && retornoAlm > saidaAlm) {
            duracaoAlmoco = retornoAlm - saidaAlm;

            // Aplicar tolerância
            const diffAlmoco = duracaoAlmoco - almocoPadrao;
            if (Math.abs(diffAlmoco) <= tolAlmoco) {
                duracaoAlmoco = almocoPadrao;
            }
        }

        // Calcular horas trabalhadas
        const trabalhadas = (saida - entrada) - duracaoAlmoco;
        
        // IMPORTANTE: Usar os minutos extras da REGRA DE HORÁRIO, não do período
        const minutosExtrasRegra = regra.minutosExtras || 0;
        // Carga esperada = 8h (480 min) + minutos extras da regra
        const carga = 480 + minutosExtrasRegra;
        let saldo = trabalhadas - carga;

        // Aplicar tolerância na saída
        if (Math.abs(saldo) <= tolSaida) {
            saldo = 0;
        }

        // Determinar status
        let status = 'ok';
        if (saldo > 0) status = 'extra';
        if (saldo < 0) status = 'falta';

        return {
            trabalhadas,
            saldo,
            temRegistro: true,
            status,
            detalhes: {
                entrada,
                saida,
                duracaoAlmoco,
                carga,
                minutosExtrasRegra,
                minutosExtrasPeriodo
            }
        };
    },

    /**
     * Calcula horas com contexto de acordo/eventos
     */
    calculateDayWithContext(registros, eventos, acordos, dataStr, registro) {
        const evento = this.getEventoByData(eventos, dataStr);
        const acordo = this.getAcordoByData(acordos, dataStr);
        const minutosExtras = this.getMinutosExtrasForDay(acordo, dataStr);
        const regra = this.getRegraHorarioForDay(acordo, dataStr);

        const calc = this.calculateDayDetail(registro, minutosExtras, regra);

        return {
            ...calc,
            evento,
            acordo,
            regra
        };
    },

    /**
     * Calcula totalizações para um período
     */
    calculatePeriodTotals(registros, eventos, acordos) {
        let totalTrabalhadas = 0;
        let totalSaldo = 0;
        let horasExtras = 0;
        let horasFaltas = 0;
        let horasAcordo = 0;
        let diasComExtra = 0;
        let diasComFalta = 0;

        registros.forEach(registro => {
            const calc = this.calculateDayWithContext(
                registros, eventos, acordos, registro.data, registro
            );

            totalTrabalhadas += calc.trabalhadas;
            totalSaldo += calc.saldo;

            if (calc.saldo > 0) {
                horasExtras += calc.saldo;
                diasComExtra++;
            } else if (calc.saldo < 0) {
                horasFaltas += Math.abs(calc.saldo);
                diasComFalta++;
            }

            if (calc.minutosExtras && calc.minutosExtras > 0) {
                horasAcordo += calc.minutosExtras;
            }
        });

        return {
            totalTrabalhadas,
            totalSaldo,
            horasExtras,
            horasFaltas,
            horasAcordo,
            diasComExtra,
            diasComFalta,
            diasProcessados: registros.length
        };
    }
};
